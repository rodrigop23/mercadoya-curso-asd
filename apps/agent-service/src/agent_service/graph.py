"""Orquestador determinista. Agent Server administra persistencia y credenciales."""

from typing import Literal

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from agent_service.actions import PROPOSAL_NAMES
from agent_service.agents.post_sale import post_sale
from agent_service.agents.shopping import shopping
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
from agent_service.guardrails.privacy import configure_trace_privacy
from agent_service.responses import guarded_response
from agent_service.state import AgentState


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
                "last_domain_category": None,
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
                "last_domain_category": decision.category,
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
        "last_domain_category": "fuera_de_dominio" if messages else None,
    }


async def output_guard(state: AgentState, config: RunnableConfig):
    response = state["messages"][-1]
    if not response.additional_kwargs.get("output_guarded"):
        response = guarded_response(response, state, config)
    return {"messages": [response], "pii_notice_pending": False}


def route(state: AgentState) -> Command[Literal["shopping", "post_sale"]]:
    category = state.get("last_domain_category")
    if category in {"productos", "carrito"}:
        agent, reason = "shopping", category
    elif category in {"pedidos", "pagos_envios"}:
        agent, reason = "post_sale", category
    else:
        active = state.get("active_agent")
        agent = active if active in {"shopping", "post_sale"} else "shopping"
        reason = "sticky"
    return Command(goto=agent, update={"active_agent": agent, "route_reason": reason})


configure_trace_privacy()

builder = StateGraph(AgentState)
builder.add_node("input_guard", input_guard)
builder.add_node("domain_guard", domain_guard)
builder.add_node("route", route)
builder.add_node("shopping", shopping)
builder.add_node("post_sale", post_sale)
builder.add_node("output_guard", output_guard)
builder.add_edge(START, "input_guard")
builder.add_conditional_edges(
    "input_guard", lambda state: END if state.get("input_blocked") else "domain_guard"
)
builder.add_conditional_edges(
    "domain_guard", lambda state: END if state.get("domain_blocked") else "route"
)
builder.add_edge("output_guard", END)
builder.add_edge("shopping", "output_guard")
builder.add_edge("post_sale", "output_guard")
graph = builder.compile()
