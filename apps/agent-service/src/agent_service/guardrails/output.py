"""Validación de respuestas contra datos estructurados del turno actual."""

import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from langchain_core.messages import ToolMessage

from agent_service.guardrails.input import normalize
from agent_service.guardrails.pii import redact_pii

UNCONFIRMED = "No tengo ese dato confirmado; puedo buscarlo en el catálogo si quieres"
SECRET_REPLY = "No puedo compartir información privada del sistema"
SECRETS = re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]+|Bearer\s+|\bsk-[\w-]+|\blsv2_[\w-]+")
AMOUNTS = re.compile(r"S/\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*soles\b", re.I)
STOCK = re.compile(
    r"\bstock\s*(?:disponible\s*)?(?:de\s*|:\s*|=\s*)?(\d+)"
    r"|\b(?:hay|quedan|disponibles)\s+(\d+)\s+unidades"
    r"|\b(\d+)\s+unidades\s+(?:en stock|disponibles)",
    re.I,
)
PRICE_FIELDS = {"price_pen", "unit_price_pen", "total_pen"}


def structured_data(message: ToolMessage):
    if isinstance(message.artifact, dict):
        data = message.artifact.get("structured_content")
        if isinstance(data, (dict, list)):
            return data
    text = message.text.removeprefix("<datos_herramienta>").removesuffix("</datos_herramienta>")
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return {}


def evidence(messages):
    prices, stocks = set(), set()

    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in PRICE_FIELDS:
                    try:
                        prices.add(Decimal(str(child)))
                    except InvalidOperation:
                        pass
                elif key == "stock" and type(child) is int:
                    stocks.add(child)
                elif isinstance(child, (dict, list)):
                    collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    for message in reversed(messages):
        if message.type == "human":
            break
        if isinstance(message, ToolMessage):
            collect(structured_data(message))
    return prices, stocks


@dataclass(frozen=True)
class OutputDecision:
    text: str
    reason: str | None = None
    action: str | None = None


def after_model(
    text: str, messages, system_prompt: str, internal_token: str = ""
) -> OutputDecision:
    words = normalize(system_prompt).split()
    normalized = " ".join(normalize(text).split())
    if any(" ".join(words[i : i + 8]) in normalized for i in range(len(words) - 7)):
        return OutputDecision("No puedo compartir mis instrucciones internas", "leak", "replaced")
    if SECRETS.search(text) or (internal_token and internal_token in text):
        return OutputDecision(SECRET_REPLY, "secret", "replaced")
    safe = redact_pii(text)
    prices, stocks = evidence(messages)
    amounts = [Decimal((a or b).replace(",", ".")) for a, b in AMOUNTS.findall(safe)]
    quantities = [int(next(group for group in match if group)) for match in STOCK.findall(safe)]
    if any(amount not in prices for amount in amounts) or any(q not in stocks for q in quantities):
        return OutputDecision(UNCONFIRMED, "ungrounded_price", "replaced")
    return OutputDecision(
        safe, "pii" if safe != text else None, "redacted" if safe != text else None
    )
