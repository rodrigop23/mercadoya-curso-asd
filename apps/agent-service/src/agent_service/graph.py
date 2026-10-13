"""Agent Server owns persistence. Credentials never enter state or proposals.

Read auth_user only AFTER interrupt for writes: a resumed node starts again with
identity from the new request. All work before interrupt is read-only/idempotent.
"""

import json
import os
from uuid import NAMESPACE_URL, uuid5

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
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
from agent_service.config import settings
from agent_service.guardrails.domain import (
    CLASSIFIER_ERROR_REPLY,
    ClassificationError,
    domain_history,
    get_classifier,
)
from agent_service.guardrails.input import OFF_TOPIC_REPLY, PII_NOTICE, before_model
from agent_service.guardrails.moderation import moderate
from agent_service.guardrails.observability import record_domain, record_event, record_moderation
from agent_service.guardrails.output import after_model, structured_data
from agent_service.guardrails.privacy import configure_trace_privacy
from agent_service.guardrails.tool import sanitize_tool_message
from agent_service.history import trim_history
from agent_service.mcp_tools import get_tools
from agent_service.memory import MEMORY_TOOLS, memory_prompt
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


class AgentState(MessagesState):
    input_blocked: bool
    pii_notice_pending: bool
    domain_blocked: bool
    recent_confirmation: bool
    last_domain_in_domain: bool


async def input_guard(state: AgentState, config: RunnableConfig):
    last = state["messages"][-1]
    if last.type != "human":
        return {}
    cfg = settings()
    decision = before_model(last.text, cfg.max_input_chars)
    redacted = decision.redacted or last.additional_kwargs.get("guardrail_pii_redacted", False)
    original_length = last.additional_kwargs.get("guardrail_input_length", len(last.text))
    if original_length > cfg.max_input_chars and decision.reason != "length":
        decision = before_model("x" * (cfg.max_input_chars + 1), cfg.max_input_chars)
    human = HumanMessage(content=before_model(last.text, cfg.max_input_chars).text, id=last.id)
    messages = [human]
    if redacted:
        record_event(config, "input", "pii", "redacted")
    response = decision.response
    if decision.reason:
        record_event(config, "input", decision.reason, "blocked")
    else:
        status = await moderate(human.text, enabled=cfg.moderation)
        record_moderation(config, status)
        if status == "blocked":
            response = "No puedo ayudar con ese contenido. ¿Te ayudo con algo de la tienda?"
            record_event(config, "input", "moderation", "blocked")
    if response:
        # No reintroducir instrucciones rechazadas en el prompt de un turno posterior.
        human.content = "[mensaje bloqueado]"
        messages.append(AIMessage(content=(PII_NOTICE + "\n" if redacted else "") + response))
    return {
        "messages": messages,
        "input_blocked": bool(response),
        "pii_notice_pending": redacted and not response,
        **({"last_domain_in_domain": False} if response else {}),
    }


async def domain_guard(state: AgentState, config: RunnableConfig):
    last = state["messages"][-1]
    if last.type != "human":
        return {"domain_blocked": False}
    cfg = settings()
    previous = state["messages"][:-1]
    history = domain_history(previous)
    previous_ai = next((item for item in reversed(history) if item["type"] == "ai"), None)
    if previous_ai is not None and "last_domain_in_domain" in state:
        previous_ai["in_domain"] = state["last_domain_in_domain"]
    recent = state.get("recent_confirmation", False) or any(
        isinstance(message, AIMessage)
        and any(call["name"] in PROPOSAL_NAMES for call in message.tool_calls)
        for message in reversed(previous[-2:])
    )
    try:
        decision = await get_classifier().classify(last.text, history, recent)
    except ClassificationError as error:
        metadata = {
            "domain_category": "classifier_error",
            "domain_in_domain": None,
            "domain_confidence": None,
            "domain_in_domain_probability": None,
            "domain_classifier": cfg.classifier_provider,
            "domain_model": cfg.classifier_model,
            "domain_latency_ms": error.latency_ms,
            "domain_error_subtype": error.subtype,
            "domain_fail_open": cfg.classifier_fail_open,
        }
        record_domain(config, metadata)
        record_event(config, "domain", "classifier_error", "error")
        if cfg.classifier_fail_open:
            return {
                "domain_blocked": False,
                "recent_confirmation": False,
                "last_domain_in_domain": False,
            }
        response = CLASSIFIER_ERROR_REPLY
        # Un fallo no juzga el contenido: conserva el mensaje humano redactado.
        messages = []
    else:
        record_domain(
            config,
            {
                "domain_category": decision.category,
                "domain_in_domain": decision.in_domain,
                "domain_confidence": decision.confidence,
                "domain_in_domain_probability": decision.in_domain_probability,
                "domain_classifier": decision.classifier,
                "domain_model": decision.model,
                "domain_latency_ms": decision.latency_ms,
            },
        )
        record_event(
            config, "domain", decision.category, "allowed" if decision.in_domain else "blocked"
        )
        if decision.in_domain:
            return {
                "domain_blocked": False,
                "recent_confirmation": False,
                "last_domain_in_domain": True,
            }
        response = OFF_TOPIC_REPLY
        messages = [HumanMessage(content="[mensaje bloqueado]", id=last.id)]
    if state.get("pii_notice_pending"):
        response = PII_NOTICE + "\n" + response
    return {
        "messages": [*messages, AIMessage(content=response)],
        "domain_blocked": True,
        "pii_notice_pending": False,
        "recent_confirmation": False,
        "last_domain_in_domain": False,
    }


def guarded_response(response, state, config, model_messages=None):
    # Se valida antes de escribir el resultado del modelo en cualquier checkpoint.
    if response.tool_calls:
        from agent_service.guardrails.input import detect_injection
        from agent_service.guardrails.pii import contains_pii

        raw_args = json.dumps([call["args"] for call in response.tool_calls], ensure_ascii=False)
        if detect_injection(raw_args):
            record_event(config, "output", "injection", "blocked")
            return AIMessage(content="No guardo datos personales", id=response.id)
        if contains_pii(raw_args):
            only_memory = all(call["name"] == "remember_preference" for call in response.tool_calls)
            if not only_memory:
                record_event(config, "output", "pii", "blocked")
                return AIMessage(content="No guardo datos personales", id=response.id)
            from agent_service.guardrails.tool import sanitize_data

            response = response.model_copy(
                update={"tool_calls": sanitize_data(response.tool_calls)}
            )
            record_event(config, "output", "pii", "redacted")
        # No conservar reasoning ni texto auxiliar sin validar.
        return AIMessage(content="", tool_calls=response.tool_calls, id=response.id)
    decision = after_model(
        response.text,
        model_messages if model_messages is not None else state["messages"],
        SYSTEM_PROMPT,
        settings().mcp_internal_token,
    )
    if decision.reason:
        record_event(config, "output", decision.reason, decision.action)
    content = decision.text
    if state.get("pii_notice_pending"):
        content = PII_NOTICE + "\n" + content
    return AIMessage(content=content, id=response.id, additional_kwargs={"output_guarded": True})


async def output_guard(state: AgentState, config: RunnableConfig):
    response = state["messages"][-1]
    if not response.additional_kwargs.get("output_guarded"):
        response = guarded_response(response, state, config)
    return {"messages": [response], "pii_notice_pending": False}


async def assistant(state: AgentState, config: RunnableConfig, runtime: Runtime = None) -> dict:
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    store = runtime.store if runtime else None
    if store is not None:
        preference_prompt = await memory_prompt(store, config)
        if preference_prompt:
            # Un único system inicial permite include_system al recortar el historial.
            messages[0] = SystemMessage(content=SYSTEM_PROMPT + "\n" + preference_prompt)
    tools = []
    provider = os.getenv("AGENT_MODEL_PROVIDER", "openai")
    last = state["messages"][-1]
    scripted_tool = provider == "scripted" and (
        last.type != "human" or last.text.startswith("/tool ")
    )
    if scripted_tool or (provider == "openai" and os.getenv("OPENAI_API_KEY")):
        available = await get_tools()
        tools = [*reading_tools(available), *PROPOSAL_TOOLS] if available else []
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
                        guarded_response(AIMessage(content=UNAVAILABLE_MESSAGE), state, config)
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
    return {"messages": [guarded_response(response, state, config, model_messages)]}


def tool_failure(error: Exception) -> str:
    return "El servicio de consultas no está disponible ahora. Inténtalo de nuevo más tarde."


async def tools(state: AgentState, config: RunnableConfig, runtime: Runtime):
    node = ToolNode(
        [*reading_tools(await get_tools()), *MEMORY_TOOLS], handle_tool_errors=tool_failure
    )
    # Un ToolNode invocado desde un nodo propio necesita el Runtime explícito.
    result = await node.ainvoke(state, config, runtime=runtime)
    return {"messages": [sanitize_tool_message(message, config) for message in result["messages"]]}


def route_after_assistant(state: MessagesState):
    last = state["messages"][-1]
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return "output_guard"
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


async def confirm_action(state: MessagesState, config: RunnableConfig):
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


configure_trace_privacy()

builder = StateGraph(AgentState)
builder.add_node("input_guard", input_guard)
builder.add_node("domain_guard", domain_guard)
builder.add_node("assistant", assistant)
builder.add_node("output_guard", output_guard)
builder.add_node("tools", tools)
builder.add_node("confirm_action", confirm_action)
builder.add_edge(START, "input_guard")
builder.add_conditional_edges(
    "input_guard", lambda state: END if state.get("input_blocked") else "domain_guard"
)
builder.add_conditional_edges(
    "domain_guard", lambda state: END if state.get("domain_blocked") else "assistant"
)
builder.add_edge("output_guard", END)
builder.add_conditional_edges("assistant", route_after_assistant)
builder.add_edge("tools", "assistant")
builder.add_edge("confirm_action", "assistant")
graph = builder.compile()
