import asyncio
import json
from functools import partial
from pathlib import Path
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from pydantic import ValidationError
from test_mcp_tools import CaptureTracer

from agent_service import graph as module
from agent_service.actions import ActionResume, action_adapter, proposal_adapter
from agent_service.agents import specialist
from agent_service.agents.shopping import PROPOSAL_NAMES, READ_TOOLS
from agent_service.prompts import SHOPPING_PROMPT

shopping_assistant = partial(
    specialist.assistant,
    read_tools=READ_TOOLS,
    proposal_names=PROPOSAL_NAMES,
    prompt=SHOPPING_PROMPT,
)

confirm_action = partial(specialist.confirm_action, proposal_names=specialist.PROPOSAL_NAMES)

CONTRACTS = Path(__file__).resolve().parents[3] / "packages/contracts/agent"
PID = "00000000-0000-4000-8000-000000000001"


def test_generated_schema_matches():
    expected = json.dumps(action_adapter.json_schema(), ensure_ascii=False, indent=2) + "\n"
    assert (CONTRACTS / "agent-action.schema.json").read_text() == expected


@pytest.mark.parametrize(
    "path", sorted((CONTRACTS / "fixtures").glob("*.json")), ids=lambda p: p.stem
)
def test_shared_fixtures(path):
    fixture = json.loads(path.read_text())
    adapter = proposal_adapter if fixture["type"] == "proposal" else ActionResume
    if fixture["valid"]:
        if adapter is proposal_adapter:
            adapter.validate_python(fixture["payload"])
        else:
            adapter.model_validate(fixture["payload"])
    else:
        with pytest.raises(ValidationError):
            if adapter is proposal_adapter:
                adapter.validate_python(fixture["payload"])
            else:
                adapter.model_validate(fixture["payload"])


@pytest.mark.parametrize("kind", ["add_to_cart", "cancel_order"])
@pytest.mark.parametrize("decision", ["approve", "reject", "invalid", "stale"])
def test_confirm_replays_reads_only_and_current_token(monkeypatch, kind, decision):
    reads, writes, proposals = [], [], []
    tracer = CaptureTracer()
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")

    async def fake_tools():
        # assistant only needs definitions; actual calls are observed separately here.
        return specialist.PROPOSAL_TOOLS

    async def fake_mcp(name, args, config):
        token = config["configurable"]["langgraph_auth_user"]["token"]
        data = {}
        if name == "get_product":
            reads.append(token)
            data = dict(title="Audífonos", price_pen="12.90", stock=7)
        elif name == "get_my_order":
            reads.append(token)
            data = dict(
                status="pending",
                total_pen="25.80",
                items=[dict(quantity=2)],
                created_at="2026-10-12T10:00:00Z",
            )
        elif name == "cancel_my_order":
            writes.append(token)
            data = dict(order_id=PID, status="cancelled", already_cancelled=False)
        return ToolMessage(content=json.dumps(data), tool_call_id="validation")

    original_interrupt = specialist.interrupt

    def observe_interrupt(proposal):
        proposals.append(proposal)
        return original_interrupt(proposal)

    monkeypatch.setattr(specialist, "get_tools", fake_tools)
    monkeypatch.setattr(specialist, "call_mcp", fake_mcp)
    monkeypatch.setattr(specialist, "interrupt", observe_interrupt)
    graph = module.builder.compile(checkpointer=InMemorySaver())

    async def run():
        def config(token):
            return {
                "configurable": {
                    "thread_id": str(kind) + decision,
                    "langgraph_auth_user": {"token": token},
                },
                "callbacks": [tracer],
            }

        args = dict(product_id=PID, quantity=2) if kind == "add_to_cart" else dict(order_id=PID)
        initial = await graph.ainvoke(
            {"messages": [HumanMessage(f"/tool propose_{kind} " + json.dumps(args))]},
            config("secret-original"),
        )
        intr = initial["__interrupt__"][0]
        proposal_adapter.validate_python(intr.value)
        assert writes == [] and reads == ["secret-original"]
        resume = dict(action_id=intr.value["action_id"], approved=decision == "approve")
        if decision == "invalid":
            resume["approved"] = "true"
        if decision == "stale":
            resume["action_id"] = str(uuid4())
        if kind == "add_to_cart" and decision == "approve":
            resume["result"] = dict(applied=True, quantity_in_cart=4)
        final = await graph.ainvoke(Command(resume={intr.id: resume}), config("secret-resumed"))
        assert reads == ["secret-original", "secret-resumed"]
        assert proposals[0]["action_id"] == proposals[1]["action_id"]
        assert writes == (
            ["secret-resumed"] if kind == "cancel_order" and decision == "approve" else []
        )
        text = final["messages"][-1].text
        if decision == "reject":
            assert "no aprobó" in text
        elif decision in {"stale", "invalid"}:
            assert "no corresponde" in text
        else:
            assert ("Cantidad final: 4" if kind == "add_to_cart" else "Pedido cancelado") in text
        # A second resume has no pending node and cannot execute another write.
        before = len(writes)
        await graph.ainvoke(Command(resume={intr.id: resume}), config("secret-resumed"))
        assert len(writes) == before
        serialized = json.dumps([initial, final, resume, tracer.runs], default=str)
        assert "secret-original" not in serialized and "secret-resumed" not in serialized
        assert "Bearer" not in serialized

    asyncio.run(run())


@pytest.mark.parametrize("other", ["propose_add_to_cart", "get_product"])
def test_multiple_calls_do_not_interrupt_or_execute(monkeypatch, other):
    calls = [
        dict(id="a", name="propose_add_to_cart", args=dict(product_id=PID, quantity=1)),
        dict(id="b", name=other, args={}),
    ]

    async def never_call(*args):
        raise AssertionError("No debe consultar ni ejecutar herramientas")

    monkeypatch.setattr(specialist, "call_mcp", never_call)
    result = asyncio.run(
        confirm_action({"messages": [AIMessage(content="", tool_calls=calls)]}, {})
    )
    assert len(result["messages"]) == 2
    assert all("una acción a la vez" in m.text for m in result["messages"])


def test_model_filters_write_tools(monkeypatch):
    from langchain_core.tools import tool

    @tool
    def cancel_my_order(order_id: str) -> str:
        """Nunca enlazar al modelo."""
        raise AssertionError

    async def available():
        return [cancel_my_order, *specialist.PROPOSAL_TOOLS]

    seen = []

    async def reply(messages, config, tools):
        seen.extend(t.name for t in tools)
        return AIMessage(content="respuesta")

    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")
    monkeypatch.setattr(specialist, "get_tools", available)
    monkeypatch.setattr(specialist, "reply", reply)
    asyncio.run(
        shopping_assistant({"messages": [HumanMessage("/tool propose_cancel_order {}")]}, {})
    )
    assert set(seen) == {"propose_add_to_cart"}
    assert "cancel_my_order" not in seen


@pytest.mark.parametrize(
    "name,args,data,status,text",
    [
        ("propose_add_to_cart", dict(product_id=PID, quantity=21), {}, "success", "validar"),
        (
            "propose_add_to_cart",
            dict(product_id=PID, quantity=2),
            dict(stock=1),
            "success",
            "stock suficiente",
        ),
        (
            "propose_add_to_cart",
            dict(product_id=PID, quantity=2),
            {},
            "error",
            "Producto no encontrado",
        ),
        (
            "propose_cancel_order",
            dict(order_id=PID),
            dict(status="confirmed"),
            "success",
            "ya no se puede cancelar",
        ),
        (
            "propose_cancel_order",
            dict(order_id=PID),
            {},
            "error",
            "No encontré ese pedido entre los tuyos",
        ),
    ],
)
def test_failed_validation_has_no_interrupt(monkeypatch, name, args, data, status, text):
    async def fake_mcp(*_args):
        return ToolMessage(
            content=text if status == "error" else json.dumps(data),
            tool_call_id="validation",
            status=status,
        )

    def never_interrupt(*_args):
        raise AssertionError("Una propuesta inválida no debe interrumpir")

    monkeypatch.setattr(specialist, "call_mcp", fake_mcp)
    monkeypatch.setattr(specialist, "interrupt", never_interrupt)
    result = asyncio.run(
        confirm_action(
            {
                "messages": [
                    AIMessage(content="", tool_calls=[dict(id="one", name=name, args=args)])
                ]
            },
            {},
        )
    )
    assert text in result["messages"][0].text


@pytest.mark.parametrize(
    "result,text",
    [
        (dict(applied=False, reason="stock"), "stock suficiente"),
        (dict(applied=False, reason="cart_full"), "20 productos"),
        (dict(applied=False, reason="checkout_locked"), "checkout en curso"),
        (None, "no informó un resultado válido"),
    ],
)
def test_cart_reports_web_result_without_write(monkeypatch, result, text):
    from uuid import NAMESPACE_URL, uuid5

    async def fake_mcp(name, *_args):
        assert name == "get_product"
        return ToolMessage(
            content=json.dumps(dict(title="Café", price_pen="12.90", stock=4)),
            tool_call_id="validation",
        )

    value = dict(action_id=str(uuid5(NAMESPACE_URL, "mercadoya:action:one")), approved=True)
    if result is not None:
        value["result"] = result
    monkeypatch.setattr(specialist, "call_mcp", fake_mcp)
    monkeypatch.setattr(specialist, "interrupt", lambda _: value)
    response = asyncio.run(
        confirm_action(
            {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            dict(
                                id="one",
                                name="propose_add_to_cart",
                                args=dict(product_id=PID, quantity=2),
                            )
                        ],
                    )
                ]
            },
            {},
        )
    )
    assert text in response["messages"][0].text


@pytest.mark.parametrize(
    "name,allowed",
    [
        ("propose_cancel_order", {"propose_add_to_cart"}),
        ("propose_add_to_cart", {"propose_cancel_order"}),
    ],
)
def test_foreign_proposal_rejected_in_code(monkeypatch, name, allowed):
    async def never_mcp(*args):
        pytest.fail("Una propuesta ajena no debe llegar a MCP")

    monkeypatch.setattr(specialist, "call_mcp", never_mcp)
    result = asyncio.run(
        specialist.confirm_action(
            {"messages": [AIMessage("", tool_calls=[dict(id="foreign", name=name, args={})])]},
            {},
            proposal_names=allowed,
        )
    )
    assert result["messages"][0].tool_call_id == "foreign"
    assert "no está permitida" in result["messages"][0].text
    assert not result["recent_confirmation"]
