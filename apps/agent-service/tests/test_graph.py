import asyncio
import importlib
import json

from langchain_core.messages import AIMessage, HumanMessage

from agent_service import graph as graph_module
from agent_service import model
from agent_service.agents import specialist


def test_echo(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "echo")
    result = asyncio.run(
        graph_module.graph.ainvoke({"messages": [HumanMessage("lista de compras")]})
    )
    assert result["messages"][-1].content == "eco: lista de compras"
    assert graph_module.graph.checkpointer is None


def test_openai_without_key_imports_and_replies(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    importlib.reload(graph_module)
    result = asyncio.run(graph_module.graph.ainvoke({"messages": [HumanMessage("hola")]}))
    assert result["messages"][-1].content == model.MISSING_KEY_MESSAGE


def test_model_receives_prompt_history_and_no_credentials(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    observed = {}

    async def fake_tools():
        from langchain_core.tools import tool

        @tool
        def get_product() -> str:
            """Producto de prueba."""
            return "producto"

        return [get_product]

    monkeypatch.setattr(specialist, "get_tools", fake_tools)

    class FakeModel:
        def bind_tools(self, tools):
            observed["tools"] = tools
            return self

        async def ainvoke(self, messages, config):
            observed.update(messages=messages, config=config)
            return AIMessage(content="respuesta")

    monkeypatch.setattr(model, "create_model", FakeModel)
    result = asyncio.run(
        graph_module.graph.ainvoke(
            {"messages": [HumanMessage("hola"), AIMessage("saludo"), HumanMessage("ayuda")]},
            config={"configurable": {"langgraph_auth_user": {"token": "private-jwt"}}},
        )
    )
    assert observed["messages"][0].type == "system"
    assert [m.content for m in observed["messages"][1:]] == ["hola", "saludo", "ayuda"]
    assert "configurable" not in observed["config"]
    assert "private-jwt" not in json.dumps(result, default=str)


def test_model_env(monkeypatch):
    import langchain_openai

    monkeypatch.setenv("AGENT_MODEL", "configured-model")
    monkeypatch.setenv("AGENT_REASONING_EFFORT", "medium")
    monkeypatch.setattr(langchain_openai, "ChatOpenAI", lambda **kwargs: kwargs)
    assert model.create_model() == {
        "model": "configured-model",
        "use_responses_api": True,
        "reasoning": {"effort": "medium"},
    }


def test_specialist_routes_and_sticky_without_extra_model_call(monkeypatch):
    from langgraph.checkpoint.memory import InMemorySaver
    from test_mcp_tools import CaptureTracer

    calls = []
    tracer = CaptureTracer()
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "echo")

    async def observed_reply(messages, config, tools):
        calls.append((messages[0].text, config["metadata"].copy(), config["tags"].copy()))
        return AIMessage("respuesta")

    monkeypatch.setattr(specialist, "reply", observed_reply)
    graph = graph_module.builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "routing"}, "callbacks": [tracer]}

    async def run():
        for text, name, reason in [
            ("busco audífonos", "shopping", "productos"),
            ("¿dónde está mi pedido?", "post_sale", "pedidos"),
            ("gracias", "post_sale", "sticky"),
        ]:
            result = await graph.ainvoke({"messages": [HumanMessage(text)]}, config)
            assert result["active_agent"] == name
            assert result["route_reason"] == reason
            assert result["last_domain_category"] == (
                "conversacion" if reason == "sticky" else reason
            )
            assert calls[-1][1]["agent_name"] == name
            assert calls[-1][1]["route_reason"] == reason
            assert f"agent:{name}" in calls[-1][2]
            assert (
                "especialista de compras" if name == "shopping" else "especialista de postventa"
            ) in calls[-1][0]
        assert len(calls) == 3

    asyncio.run(run())

    def descendants(runs):
        for run in runs:
            yield run
            yield from descendants(run.get("child_runs", []))

    for name in ("shopping", "post_sale"):
        assert any(
            run["name"] == name
            and f"agent:{name}" in run["tags"]
            and run["extra"]["metadata"].get("route_reason") in {"productos", "pedidos", "sticky"}
            for run in descendants(tracer.runs)
        )


def test_scripted_specialists_cannot_execute_foreign_tools(monkeypatch):
    from agent_service.agents.post_sale import post_sale
    from agent_service.agents.shopping import shopping

    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")

    async def available():
        return specialist.PROPOSAL_TOOLS

    async def never_mcp(*args):
        raise AssertionError("No ejecutar una herramienta ajena")

    monkeypatch.setattr(specialist, "get_tools", available)
    monkeypatch.setattr(specialist, "call_mcp", never_mcp)

    async def run():
        for graph, text in [
            (shopping, "/tool list_my_orders {}"),
            (
                post_sale,
                "/tool propose_add_to_cart "
                '{"product_id":"00000000-0000-4000-8000-000000000001","quantity":1}',
            ),
        ]:
            result = await graph.ainvoke({"messages": [HumanMessage(text)]})
            assert result["messages"][-1].text == "Solicitud de herramienta inválida"
            assert not any(getattr(message, "tool_calls", []) for message in result["messages"])

    asyncio.run(run())


def test_studio_can_expand_specialists():
    nodes = graph_module.graph.get_graph(xray=True).nodes
    for name in ("shopping", "post_sale"):
        for node in ("assistant", "tools", "confirm_action"):
            assert f"{name}:{node}" in nodes


def test_toolnode_rejects_foreign_read_even_if_model_calls_it(monkeypatch):
    from langchain_core.tools import tool

    from agent_service.agents.shopping import shopping

    @tool
    def list_my_orders() -> str:
        """Herramienta exclusiva de postventa."""
        raise AssertionError("Compras no puede ejecutar esta herramienta")

    async def available():
        return [list_my_orders]

    async def malicious_reply(messages, config, tools):
        if messages[-1].type == "tool":
            return AIMessage("rechazado")
        return AIMessage("", tool_calls=[dict(id="foreign", name="list_my_orders", args={})])

    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")
    monkeypatch.setattr(specialist, "get_tools", available)
    monkeypatch.setattr(specialist, "reply", malicious_reply)
    result = asyncio.run(shopping.ainvoke({"messages": [HumanMessage("/tool list_my_orders {}")]}))
    tool_message = next(message for message in result["messages"] if message.type == "tool")
    assert tool_message.status == "error"
    assert tool_message.tool_call_id == "foreign"
