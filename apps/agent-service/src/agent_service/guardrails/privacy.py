"""Redacta la entrada del servidor y el contenido exportado a LangSmith."""

import re

from langgraph_sdk import Auth
from langsmith import Client, configure
from langsmith.utils import tracing_is_enabled

from agent_service.guardrails.pii import redact_pii

TRACE_SECRETS = re.compile(
    r"eyJ[\w-]+\.[\w-]+\.[\w-]+|Bearer\s+\S+|\bsk-[\w-]+|\blsv2_[\w-]+"
)
PRIVATE_FIELDS = {"token", "authorization", "x-mcp-internal-token", "api_key"}


def sanitize_trace(value):
    """Sanea copias serializadas, incluidos resultados crudos, metadata y errores."""
    if isinstance(value, dict):
        return {
            key: "[secreto]" if key.casefold() in PRIVATE_FIELDS else sanitize_trace(child)
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [sanitize_trace(child) for child in value]
    if isinstance(value, str):
        return TRACE_SECRETS.sub("[secreto]", redact_pii(value))
    return value


def configure_trace_privacy():
    # Sin tracing no se construye un cliente. Los flags HIDE siguen controlados por el entorno.
    if tracing_is_enabled():
        configure(client=Client(anonymizer=sanitize_trace))


def sanitize_run_input(value: dict):
    payload = (value.get("kwargs") or {}).get("input")
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        return
    for message in payload["messages"]:
        if not isinstance(message, dict) or message.get("role", message.get("type")) not in {
            "user",
            "human",
        }:
            # El cliente solo agrega entradas humanas; roles del sistema y tools son del grafo.
            raise Auth.exceptions.HTTPException(status_code=422, detail="Entrada de chat inválida")
        content = message.get("content", "")
        raw = (
            content
            if isinstance(content, str)
            else "".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
            if isinstance(content, list)
            else ""
        )
        safe = redact_pii(raw)
        identity = {key: message[key] for key in ("role", "type", "id") if key in message}
        message.clear()
        message.update(identity, content=safe)
        # Elimina bloques/metadata arbitrarios para no conservar PII oculta en ellos.
        message["additional_kwargs"] = {
            "guardrail_pii_redacted": safe != raw,
            "guardrail_input_length": len(raw),
        }
