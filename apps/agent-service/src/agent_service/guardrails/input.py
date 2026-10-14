"""Redacción, longitud e inyección antes del clasificador de dominio."""

import re
import unicodedata
from dataclasses import dataclass

from agent_service.guardrails.pii import redact_pii

PII_NOTICE = "Por tu seguridad, no guardo datos personales como correos, teléfonos, DNI o tarjetas"
INJECTION_REPLY = "No puedo cambiar mis instrucciones. ¿Te ayudo con algo de la tienda?"
OFF_TOPIC_REPLY = (
    "Solo puedo ayudarte con compras en MercadoYa: productos, carrito, pedidos y tus preferencias."
)
INJECTION = re.compile(
    r"(?:ignora|ignorar|ignore|disregard|forget|olvida)\b.{0,60}"
    r"(?:instruccion|instruction|prompt|reglas|rules)"
    r"|\beres\s+ahora\b|\byou\s+are\s+now\b|system\s*prompt"
    r"|(?:muestra|revela|show|reveal)\b.{0,40}\bprompt\b"
    r"|developer\s*mode|modo\s*(?:desarrollador|developer)"
    r"|<\s*/?\s*(?:system|developer|assistant)\b|###",
    re.DOTALL,
)


def normalize(text: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFKD", text.casefold())
        if not unicodedata.combining(char)
    )


def detect_injection(text: str) -> bool:
    return bool(INJECTION.search(normalize(text)))


@dataclass(frozen=True)
class InputDecision:
    text: str
    reason: str | None = None
    response: str | None = None
    redacted: bool = False


def before_model(text: str, max_chars: int = 2000) -> InputDecision:
    safe = redact_pii(text)
    redacted = safe != text
    if len(text) > max_chars:
        return InputDecision(
            safe,
            "length",
            f"Tu mensaje es muy largo; resúmelo en menos de {max_chars:,} caracteres".replace(
                ",", "."
            ),
            redacted,
        )
    if detect_injection(safe):
        return InputDecision(safe, "injection", INJECTION_REPLY, redacted)
    return InputDecision(safe, redacted=redacted)
