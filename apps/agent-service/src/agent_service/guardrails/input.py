"""Hooks deterministas de entrada. Ante temas ambiguos se permite la consulta."""

import re
import unicodedata
from dataclasses import dataclass

from agent_service.guardrails.pii import redact_pii

PII_NOTICE = "Por tu seguridad, no guardo datos personales como correos, teléfonos, DNI o tarjetas"
INJECTION_REPLY = "No puedo cambiar mis instrucciones. ¿Te ayudo con algo de la tienda?"
OFF_TOPIC_REPLY = "Solo puedo ayudarte con compras en MercadoYa"
INJECTION = re.compile(
    r"(?:ignora|ignorar|ignore|disregard|forget|olvida)\b.{0,60}"
    r"(?:instruccion|instruction|prompt|reglas|rules)"
    r"|\beres\s+ahora\b|\byou\s+are\s+now\b|system\s*prompt"
    r"|(?:muestra|revela|show|reveal)\b.{0,40}\bprompt\b"
    r"|developer\s*mode|modo\s*(?:desarrollador|developer)"
    r"|<\s*/?\s*(?:system|developer|assistant)\b|###",
    re.DOTALL,
)
STORE_TOPICS = re.compile(
    r"\b(?:mercadoya|tienda|producto\w*|catalogo|precio\w*|stock|carrito|pedido\w*|"
    r"envio\w*|pago\w*|compr\w*|busco|venden|tienen|preferencia\w*|recuerda\w*|recordar|recuerdas|"
    r"memoria\w*|olvida\w*|talla\w*|presupuesto|marca\w*|hola|gracias|saludos|"
    r"buenos dias|buenas tardes|buenas noches)\b"
)
ALIEN_TOPICS = re.compile(
    r"\b(?:integral\w*|derivada\w*|tarea\w* escolar\w*|ecuacion\w*|"
    r"resuelve\w*.*(?:matematica\w*|ejercicio\w*)|programa\w*.*(?:python|javascript)|"
    r"codigo|debug\w*|politica|presidente|elecciones|diagnostico|medicina|"
    r"tratamiento|enfermedad\w*|inversion\w*|finanzas personales|bitcoin)\b"
)


def normalize(text: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFKD", text.casefold())
        if not unicodedata.combining(char)
    )


def detect_injection(text: str) -> bool:
    return bool(INJECTION.search(normalize(text)))


def is_off_topic(text: str) -> bool:
    normalized = normalize(text)
    return bool(ALIEN_TOPICS.search(normalized) and not STORE_TOPICS.search(normalized))


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
    if is_off_topic(safe):
        return InputDecision(safe, "off_topic", OFF_TOPIC_REPLY, redacted)
    return InputDecision(safe, redacted=redacted)
