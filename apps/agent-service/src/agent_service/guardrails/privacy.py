"""Redacta antes de que Agent Server escriba el run y el primer checkpoint."""

from langgraph_sdk import Auth

from agent_service.guardrails.pii import redact_pii


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
