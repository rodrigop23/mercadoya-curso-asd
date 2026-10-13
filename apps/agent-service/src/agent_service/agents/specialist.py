"""Subgrafo compartido. Antes de interrupt solo se repiten lecturas idempotentes."""

import os
from uuid import NAMESPACE_URL, uuid5

from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.runtime import Runtime
from langgraph.types import interrupt
from pydantic import ValidationError

from agent_service.actions import (
    PROPOSAL_NAMES,
    PROPOSAL_TOOLS,
    ActionResume,
    CancelProposal,
    CartProposal,
)
from agent_service.guardrails.observability import (
    record_event,
    record_specialist,
)
from agent_service.guardrails.output import structured_data
from agent_service.guardrails.tool import sanitize_tool_message
from agent_service.history import trim_history
from agent_service.mcp_tools import get_tools
from agent_service.memory import MEMORY_TOOLS, memory_prompt
from agent_service.model import reply
from agent_service.responses import guarded_response
from agent_service.state import AgentState

MAX_TOOL_ITERATIONS = 6
UNAVAILABLE_MESSAGE = "El catálogo no está disponible ahora. Inténtalo de nuevo más tarde."


def tool_iterations(messages):
    count = 0
    for message in reversed(messages):
        if message.type == "human":
            break
        if isinstance(message, AIMessage) and message.tool_calls:
            count += 1
    return count


async def assistant(
    state: AgentState,
    config: RunnableConfig,
    runtime: Runtime = None,
    *,
    read_tools,
    proposal_names,
    prompt,
) -> dict:
    messages = [SystemMessage(content=prompt), *state["messages"]]
    store = runtime.store if runtime else None
    if store is not None:
        preference_prompt = await memory_prompt(store, config)
        if preference_prompt:
            # Un único system inicial permite include_system al recortar el historial.
            messages[0] = SystemMessage(content=prompt + "\n" + preference_prompt)
    tools = []
    provider = os.getenv("AGENT_MODEL_PROVIDER", "openai")
    last = state["messages"][-1]
    scripted_tool = provider == "scripted" and (
        last.type != "human" or last.text.startswith("/tool ")
    )
    if scripted_tool or (provider == "openai" and os.getenv("OPENAI_API_KEY")):
        available = await get_tools()
        tools = (
            [
                *[tool for tool in available if tool.name in read_tools],
                *[tool for tool in PROPOSAL_TOOLS if tool.name in proposal_names],
            ]
            if available
            else []
        )
        if store is not None:
            tools.extend(MEMORY_TOOLS)
        if not available:
            if (
                scripted_tool
                and last.type == "human"
                and not any(
                    last.text.startswith("/tool " + tool.name + " ") for tool in MEMORY_TOOLS
                )
            ):
                return {
                    "messages": [
                        guarded_response(
                            AIMessage(content=UNAVAILABLE_MESSAGE), state, config, prompt=prompt
                        )
                    ]
                }
            messages[0] = SystemMessage(
                content=messages[0].text
                + (
                    "\nEl catálogo y los pedidos no están disponibles ahora. "
                    "Puedes responder consultas generales, pero no inventes productos, "
                    "precios, stock ni datos de pedidos."
                )
            )
    exhausted = tool_iterations(state["messages"]) >= MAX_TOOL_ITERATIONS
    if exhausted:
        messages[0] = SystemMessage(
            content=messages[0].text
            + ("\nLlegaste al límite de consultas de este turno. Responde con los datos obtenidos.")
        )
    model_messages = trim_history(messages)
    response = await reply(model_messages, config, tools if not exhausted else [])
    return {"messages": [guarded_response(response, state, config, model_messages, prompt=prompt)]}


def tool_failure(error: Exception) -> str:
    return "El servicio de consultas no está disponible ahora. Inténtalo de nuevo más tarde."


async def tools(state: AgentState, config: RunnableConfig, runtime: Runtime, *, read_tools):
    node = ToolNode(
        [*[tool for tool in await get_tools() if tool.name in read_tools], *MEMORY_TOOLS],
        handle_tool_errors=tool_failure,
    )
    # Un ToolNode invocado desde un nodo propio necesita el Runtime explícito.
    result = await node.ainvoke(state, config, runtime=runtime)
    return {"messages": [sanitize_tool_message(message, config) for message in result["messages"]]}


def route_after_assistant(state: MessagesState):
    last = state["messages"][-1]
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return END
    return (
        "confirm_action" if any(c["name"] in PROPOSAL_NAMES for c in last.tool_calls) else "tools"
    )


async def call_mcp(name, args, config):
    """ToolNode injects ToolRuntime, including the current request config, into adapters."""
    available = [tool for tool in await get_tools() if tool.name == name]
    if not available:
        return ToolMessage(content=tool_failure(None), tool_call_id="validation", status="error")
    result = await ToolNode(available, handle_tool_errors=tool_failure).ainvoke(
        {
            "messages": [
                AIMessage(content="", tool_calls=[{"id": "validation", "name": name, "args": args}])
            ]
        },
        config,
    )
    return sanitize_tool_message(result["messages"][0], config)


def tool_data(message):
    return structured_data(message)


async def confirm_action(state: MessagesState, config: RunnableConfig, *, proposal_names):
    calls = state["messages"][-1].tool_calls
    proposal = None

    def answer(text, call=calls[0]):
        message = ToolMessage(
            content=text,
            tool_call_id=call["id"],
            artifact={
                "structured_content": proposal.model_dump(mode="json") if proposal else {},
            },
        )
        return {
            "messages": [sanitize_tool_message(message, config)],
            "recent_confirmation": proposal is not None,
        }

    if len(calls) != 1:
        return {
            "messages": [
                ToolMessage(
                    content=(
                        "Solo puedo proponer una acción a la vez; pide confirmación de una en una"
                    ),
                    tool_call_id=call["id"],
                )
                for call in calls
            ]
        }
    call = calls[0]
    if call["name"] not in proposal_names:
        return answer("Esta propuesta no está permitida para este especialista")
    # Read-only validation repeats on resume. Do not catch interrupt's control-flow exception.
    try:
        tool = next(t for t in PROPOSAL_TOOLS if t.name == call["name"])
        args = tool.args_schema.model_validate(call["args"]).model_dump(mode="json")
        action_id = uuid5(NAMESPACE_URL, "mercadoya:action:" + call["id"])
        if call["name"] == "propose_add_to_cart":
            message = await call_mcp("get_product", {"product_id": args["product_id"]}, config)
            if message.status == "error":
                return answer(message.text)
            product = tool_data(message)
            if product["stock"] < args["quantity"]:
                return answer("No hay stock suficiente para agregar esa cantidad")
            proposal = CartProposal(
                kind="add_to_cart",
                action_id=action_id,
                product_id=args["product_id"],
                title=product["title"],
                unit_price_pen=product["price_pen"],
                quantity=args["quantity"],
                stock=product["stock"],
            )
        else:
            message = await call_mcp("get_my_order", {"order_id": args["order_id"]}, config)
            if message.status == "error":
                return answer(message.text)
            order = tool_data(message)
            if order["status"] != "pending":
                return answer(
                    "Ese pedido ya no se puede cancelar (ya finalizó o el pago está en proceso)"
                )
            proposal = CancelProposal(
                kind="cancel_order",
                status="pending",
                action_id=action_id,
                order_id=args["order_id"],
                total_pen=order["total_pen"],
                items_count=sum(item["quantity"] for item in order["items"]),
                created_at=order["created_at"],
            )
    except (ValidationError, ValueError, KeyError, TypeError):
        return answer("No pude validar la propuesta; revisa el producto, pedido y cantidad")

    decision = interrupt(proposal.model_dump(mode="json"))

    try:
        resume = ActionResume.model_validate(decision)
        if resume.action_id != action_id or (
            isinstance(proposal, CancelProposal) and resume.result is not None
        ):
            return answer("La confirmación no corresponde a esta acción")
    except ValidationError:
        return answer("La confirmación no corresponde a esta acción")
    if not resume.approved:
        return answer("El comprador no aprobó la acción; no se hizo ningún cambio")
    if isinstance(proposal, CartProposal):
        result = resume.result
        if result is None:
            return answer("La web no informó un resultado válido; no puedo confirmar el cambio")
        if result.applied:
            return answer(
                f"Producto agregado al carrito. Cantidad final: {result.quantity_in_cart}"
            )
        reasons = {
            "stock": "no hay stock suficiente",
            "cart_full": "el carrito tiene 20 productos",
            "checkout_locked": "hay un checkout en curso",
            "not_found": "producto no encontrado",
            "invalid": "no se pudo validar el producto o la cantidad",
        }
        return answer(
            "No se agregó al carrito: " + reasons.get(result.reason, "cambio no aplicado")
        )

    # This read must stay after interrupt. Never capture an original request's token.
    token = config.get("configurable", {}).get("langgraph_auth_user", {}).get("token")
    if not token:
        return answer("Tu sesión venció, vuelve a iniciar sesión")
    message = await call_mcp("cancel_my_order", {"order_id": str(proposal.order_id)}, config)
    if message.status == "error":
        text = message.text
        if "no está disponible" in text:
            text = "No se pudo cancelar ahora; el pedido no cambió"
        return answer(text)
    try:
        result = tool_data(message)
        return answer(
            "Ese pedido ya estaba cancelado" if result["already_cancelled"] else "Pedido cancelado"
        )
    except (ValueError, KeyError, TypeError):
        return answer("No se pudo confirmar la cancelación; consulta el estado del pedido")


def build_specialist(name, read_tools, proposal_names, prompt):
    read_tools = frozenset(read_tools)
    proposal_names = frozenset(proposal_names)

    async def specialist_assistant(state: AgentState, config: RunnableConfig, runtime: Runtime):
        record_specialist(config, name, state.get("route_reason"))
        if tool_iterations(state["messages"]) == 0:
            record_event(config, "route", state.get("route_reason"), name)
        return await assistant(
            state,
            config,
            runtime,
            read_tools=read_tools,
            proposal_names=proposal_names,
            prompt=prompt,
        )

    async def specialist_tools(state: AgentState, config: RunnableConfig, runtime: Runtime):
        return await tools(state, config, runtime, read_tools=read_tools)

    async def specialist_confirm(state: AgentState, config: RunnableConfig):
        return await confirm_action(state, config, proposal_names=proposal_names)

    builder = StateGraph(AgentState)
    builder.add_node("assistant", specialist_assistant)
    builder.add_node("tools", specialist_tools)
    builder.add_node("confirm_action", specialist_confirm)
    builder.add_edge(START, "assistant")
    builder.add_conditional_edges(
        "assistant",
        route_after_assistant,
        {"tools": "tools", "confirm_action": "confirm_action", END: END},
    )
    builder.add_edge("tools", "assistant")
    builder.add_edge("confirm_action", "assistant")
    return builder.compile(name=name).with_config(
        tags=[f"agent:{name}"],
        metadata={"agent_name": name},
    )
