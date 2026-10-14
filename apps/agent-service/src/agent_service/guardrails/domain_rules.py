"""Lista permitida determinista para CI. No sustituye Clef en producción."""

import os
import re
from time import perf_counter

from agent_service.guardrails.domain import ClassificationError, DomainDecision
from agent_service.guardrails.input import normalize

TOOL_CATEGORIES = {
    "search_products": "productos",
    "get_product": "productos",
    "check_stock": "productos",
    "list_my_orders": "pedidos",
    "get_my_order": "pedidos",
    "propose_cancel_order": "pedidos",
    "propose_add_to_cart": "carrito",
    "remember_preference": "preferencias",
    "list_memories": "preferencias",
    "forget_memory": "preferencias",
    "forget_all_memories": "preferencias",
}
FOREIGN = re.compile(
    r"\b(?:matematic\w*|integral\w*|derivada\w*|tarea\w*|ecuacion\w*|python|javascript|"
    r"codigo fuente|funcion|compilacion|clima|weather|politica|presidente|elecciones|"
    r"finanzas personales|"
    r"receta\w*|capital de|sintoma\w*|diagnostico|enfermedad\w*|bitcoin|tradu\w*|"
    r"poema\w*|chiste\w*|partido|mundial|horoscopo|legal|cartesiano)\b"
)
KEYWORDS = {
    "preferencias": r"\b(?:recuerda\w*|recuerdas|recordar|memoria\w*|olvida\w*|preferencia\w*)\b",
    "pagos_envios": r"\b(?:descuento\w*|pago\w*|yape|plin|tarjeta\w*|envio\w*|devolucion\w*)\b",
    "pedidos": r"\b(?:pedido\w*|orden\w*)\b",
    "carrito": r"\bcarrito\b",
    "productos": r"\b(?:mercadoya|tienda|producto\w*|catalogo|precio\w*|stock|talla\w*|"
    r"presupuesto|marca\w*|compr\w*|busco|busca|buscar|venden|tienen|audifono\w*|"
    r"zapatilla\w*|regalo\w*|compara\w*)\b",
}
CONVERSATION = re.compile(
    r"(?:hola|gracias(?: por (?:tu |la )?ayuda)?|muchas gracias|saludos|adios|hasta luego|"
    r"buenos dias|buenas tardes|buenas noches|que puedes hacer|en que puedes ayudarme|"
    r"me ayudas|ayuda)[.!?¿¡\s]*"
)
FOLLOWUP = re.compile(r"\b(?:otro|otra|ese|esa|eso|este|esta|si|no|dos|uno|cuanto|cuantos)\b|\d")


class RulesClassifier:
    def __init__(self, scripted: bool = False):
        self.scripted = scripted

    def category(self, text: str) -> str:
        text = normalize(text).strip(" ¿¡")
        if self.scripted and text.startswith("/tool "):
            return TOOL_CATEGORIES.get(text.split()[1], "fuera_de_dominio")
        if FOREIGN.search(text):
            # Vocabulario ajeno puede describir un producto del catálogo.
            if not re.search(r"\b(?:busco|busca|venden|tienen)\b.*\b(?:libro|medicina)", text):
                return "fuera_de_dominio"
        if CONVERSATION.fullmatch(text):
            return "conversacion"
        for category, pattern in KEYWORDS.items():
            if re.search(pattern, text):
                return category
        return "fuera_de_dominio"

    async def classify(
        self, text: str, history: list[dict], recent_confirmation: bool
    ) -> DomainDecision:
        started = perf_counter()
        if (
            os.getenv("AGENT_TEST_CLASSIFIER_TIMEOUT") == "1"
            and os.getenv("AGENT_MODEL_PROVIDER") in {"echo", "scripted"}
            and text == "/test classifier_timeout"
        ):
            raise ClassificationError("timeout")
        category = self.category(text)
        normalized = normalize(text)
        if category == "fuera_de_dominio" and not FOREIGN.search(normalized):
            previous_ai = next((item for item in reversed(history) if item["type"] == "ai"), None)
            contextual = recent_confirmation or (
                previous_ai is not None
                and previous_ai.get(
                    "in_domain", self.category(previous_ai["text"]) != "fuera_de_dominio"
                )
                and "[mensaje bloqueado]" not in previous_ai["text"]
                and not previous_ai["text"].startswith("Solo puedo ayudarte")
            )
            if contextual and len(normalized.split()) <= 6 and FOLLOWUP.search(normalized):
                category = "conversacion"
        allowed = category != "fuera_de_dominio"
        return DomainDecision(
            allowed,
            category,
            1.0,
            float(allowed),
            "rules",
            "rules",
            round((perf_counter() - started) * 1000, 3),
        )
