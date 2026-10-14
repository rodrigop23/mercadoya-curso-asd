"""Trata texto de herramientas como datos y conserva ids, precios y stock."""

import json

from agent_service.guardrails.input import detect_injection
from agent_service.guardrails.observability import record_event
from agent_service.guardrails.pii import redact_pii

FREE_TEXT = {"title", "description", "titulo", "descripcion"}


def sanitize_data(value, *, field=""):
    if isinstance(value, dict):
        return {key: sanitize_data(child, field=key) for key, child in value.items()}
    if isinstance(value, list):
        return [sanitize_data(child, field=field) for child in value]
    if isinstance(value, str):
        if field in FREE_TEXT and detect_injection(value):
            return "[texto omitido]"
        if field in {"id", "key", "product_id", "order_id", "action_id", "creado"}:
            return value
        return redact_pii(value)
    return value


def sanitize_tool_message(message, config):
    original = message.model_dump()
    artifact = sanitize_data(message.artifact)
    content = message.content
    # Los adapters devuelven texto en bloques; cada JSON se sanea por campo.
    texts = (
        [content]
        if isinstance(content, str)
        else [block.get("text", "") for block in content if block.get("type") == "text"]
    )
    safe_texts = []
    for text in texts:
        text = text.removeprefix("<datos_herramienta>").removesuffix("</datos_herramienta>")
        try:
            safe_texts.append(json.dumps(sanitize_data(json.loads(text)), ensure_ascii=False))
        except ValueError:
            safe_texts.append("[texto omitido]" if detect_injection(text) else redact_pii(text))
    text = "\n".join(safe_texts)
    # Impide cerrar el delimitador desde texto arbitrario del catálogo.
    text = text.replace("<", "\\u003c").replace(">", "\\u003e")
    result = message.model_copy(
        update={
            "content": f"<datos_herramienta>{text}</datos_herramienta>",
            "artifact": artifact,
        }
    )
    if "[texto omitido]" in text and "[texto omitido]" not in json.dumps(original):
        record_event(config, "tool", "injection", "redacted")
    if redact_pii(json.dumps(original, ensure_ascii=False)) != json.dumps(
        original, ensure_ascii=False
    ):
        record_event(config, "tool", "pii", "redacted")
    return result
