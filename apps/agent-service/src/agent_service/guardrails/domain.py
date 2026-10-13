"""Contrato, contexto redactado y preguntas compartidas con la evaluación."""

import logging
import os
from dataclasses import dataclass
from typing import Protocol

from agent_service.config import settings
from agent_service.guardrails.pii import redact_pii

CLASSIFIER_ERROR_REPLY = (
    "No pude procesar tu mensaje en este momento. Inténtalo de nuevo en unos segundos."
)
CRITERIA = {
    "productos": "Buscar, comparar o preguntar precio, stock, tallas o detalles de productos "
    "del catálogo",
    "carrito": "Agregar al carrito o responder a una propuesta o confirmación de compra",
    "pedidos": "Estado, detalle, entrega o cancelación de pedidos propios, o códigos de pedido",
    "pagos_envios": "Métodos de pago, códigos de descuento, envíos y devoluciones en MercadoYa",
    "preferencias": "Pedir que recuerde, muestre u olvide preferencias de compra "
    "(talla, presupuesto, marcas)",
    "conversacion": "Saludo, agradecimiento, despedida, preguntar qué puede hacer el asistente, "
    "o un seguimiento corto del historial de compras",
    "fuera_de_dominio": "Cualquier tema ajeno a comprar en MercadoYa: tareas, programación, "
    "clima, política, recetas, salud, cultura general, traducciones, redacción",
}
QUESTIONS = {
    "categoria": {
        "type": "choice",
        "instructions": "¿De qué trata el mensaje_actual del comprador, considerando el historial?",
        "criteria": CRITERIA,
    },
    "en_dominio": {
        "type": "noul",
        "instructions": "¿El mensaje_actual es una consulta sobre comprar en MercadoYa "
        "o un seguimiento de esa conversación?",
    },
}


@dataclass(frozen=True)
class DomainDecision:
    in_domain: bool
    category: str
    confidence: float
    in_domain_probability: float
    classifier: str
    model: str
    latency_ms: float


class ClassificationError(Exception):
    """Solo un subtipo fijo, sin conservar excepciones o cuerpos del transporte."""

    def __init__(self, subtype: str, latency_ms: float = 0):
        self.subtype = subtype
        self.latency_ms = latency_ms
        super().__init__(f"Clasificación no disponible: {subtype}")


class DomainClassifier(Protocol):
    async def classify(
        self, text: str, history: list[dict], recent_confirmation: bool
    ) -> DomainDecision: ...


def domain_history(messages) -> list[dict]:
    history = []
    for message in messages:
        if message.type not in {"human", "ai"}:
            continue
        text = redact_pii(message.text)
        history.append({"type": message.type, "text": text[:300] if message.type == "ai" else text})
    return history[-6:]


def request_state(text: str, history: list[dict], recent_confirmation: bool) -> dict:
    return {
        "tienda": "MercadoYa, marketplace en Perú (soles PEN)",
        "confirmacion_reciente": recent_confirmation,
        "historial": [
            {
                "rol": "comprador" if item["type"] == "human" else "asistente",
                "texto": redact_pii(item["text"])[:300]
                if item["type"] == "ai"
                else redact_pii(item["text"]),
            }
            for item in history
            if item["type"] in {"human", "ai"}
        ][-6:],
        "mensaje_actual": redact_pii(text),
    }


def get_classifier() -> DomainClassifier:
    cfg = settings()
    if cfg.classifier_provider == "clef":
        from agent_service.guardrails.domain_clef import ClefClassifier

        return ClefClassifier()
    if cfg.classifier_provider == "rules":
        from agent_service.guardrails.domain_rules import RulesClassifier

        return RulesClassifier(scripted=cfg.model_provider == "scripted")
    raise ClassificationError("unconfigured")


def report_classifier_configuration():
    if settings().classifier_provider == "clef" and not (
        os.getenv("CLOUDFLARE_ACCOUNT_ID") and os.getenv("CLOUDFLARE_API_TOKEN")
    ):
        logging.getLogger(__name__).warning("classifier=clef_unconfigured")
