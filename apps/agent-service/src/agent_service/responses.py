"""Valida respuestas antes de escribirlas en checkpoints del padre o del especialista."""

import json

from langchain_core.messages import AIMessage

from agent_service.config import settings
from agent_service.guardrails.input import PII_NOTICE
from agent_service.guardrails.observability import record_event
from agent_service.guardrails.output import after_model
from agent_service.prompts import specialist_prompt


def guarded_response(response, state, config, model_messages=None, prompt=None):
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
        prompt or specialist_prompt(state.get("active_agent")),
        settings().mcp_internal_token,
    )
    if decision.reason:
        record_event(config, "output", decision.reason, decision.action)
    content = decision.text
    if state.get("pii_notice_pending"):
        content = PII_NOTICE + "\n" + content
    return AIMessage(content=content, id=response.id, additional_kwargs={"output_guarded": True})
