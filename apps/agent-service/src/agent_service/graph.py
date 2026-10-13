"""Agent Server owns persistence. Credentials never enter state or proposals.

Read auth_user only AFTER interrupt for writes: a resumed node starts again with
identity from the new request. All work before interrupt is read-only/idempotent.
"""

import json
import os
from uuid import NAMESPACE_URL, uuid5

from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt
from pydantic import ValidationError

from agent_service.actions import (
    PROPOSAL_NAMES,
    PROPOSAL_TOOLS,
    ActionResume,
    CancelProposal,
    CartProposal,
)
from agent_service.mcp_tools import get_tools
from agent_service.model import reply
from agent_service.prompts import SYSTEM_PROMPT

READ_TOOLS = {"search_products", "get_product", "check_stock", "list_my_orders", "get_my_order"}
MAX_TOOL_ITERATIONS = 6


def reading_tools(tools):
    return [tool for tool in tools if tool.name in READ_TOOLS]


UNAVAILABLE_MESSAGE = "El catálogo no está disponible ahora. Inténtalo de nuevo más tarde."


def tool_iterations(messages):
    count = 0
    for message in reversed(messages):
        if message.type == "human":
            break
        if isinstance(message, AIMessage) and message.tool_calls:
            count += 1
    return count


async def assistant(state: MessagesState, config: RunnableConfig) -> dict:
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    tools = []
    provider = os.getenv("AGENT_MODEL_PROVIDER", "openai")
    last = state["messages"][-1]
    scripted_tool = provider == "scripted" and (
        last.type != "human" or last.text.startswith("/tool ")
    )
    if scripted_tool or (provider == "openai" and os.getenv("OPENAI_API_KEY")):
        available = await get_tools()
        tools = [*reading_tools(available), *PROPOSAL_TOOLS] if available else []
        if not tools:
            if scripted_tool:
                return {"messages": [AIMessage(content=UNAVAILABLE_MESSAGE)]}
            messages.append(
                SystemMessage(
                    content=(
                        "El catálogo y los pedidos no están disponibles ahora. "
                        "Puedes responder consultas generales, pero no inventes productos, "
                        "precios, stock ni datos de pedidos."
                    )
                )
            )
    exhausted = tool_iterations(state["messages"]) >= MAX_TOOL_ITERATIONS
    if exhausted:
        messages.append(
            SystemMessage(
                content=(
                    "Llegaste al límite de consultas de este turno. "
                    "Responde con los datos obtenidos."
                )
            )
        )
    return {"messages": [await reply(messages, config, tools if not exhausted else [])]}


def tool_failure(error: Exception) -> str:
    return "El servicio de consultas no está disponible ahora. Inténtalo de nuevo más tarde."


async def tools(state: MessagesState, config: RunnableConfig):
    return await ToolNode(
        reading_tools(await get_tools()), handle_tool_errors=tool_failure
    ).ainvoke(state, config)


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
    return result["messages"][0]


def tool_data(message):
    if isinstance(message.artifact, dict) and "structured_content" in message.artifact:
        return message.artifact["structured_content"]
    content = message.content
    if isinstance(content, list):
        content = "".join(block["text"] for block in content if block.get("type") == "text")
    return json.loads(content)


async def confirm_action(state: MessagesState, config: RunnableConfig):
    calls = state["messages"][-1].tool_calls

    def answer(text, call=calls[0]):
        return {"messages": [ToolMessage(content=text, tool_call_id=call["id"])]}

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


builder = StateGraph(MessagesState)
builder.add_node("assistant", assistant)
builder.add_node("tools", tools)
builder.add_node("confirm_action", confirm_action)
builder.add_edge(START, "assistant")
builder.add_conditional_edges("assistant", route_after_assistant)
builder.add_edge("tools", "assistant")
builder.add_edge("confirm_action", "assistant")
graph = builder.compile()
