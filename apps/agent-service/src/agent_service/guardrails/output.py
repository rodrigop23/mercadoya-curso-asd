"""Valida montos y stock con la evidencia de la ventana enviada al modelo."""

import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from langchain_core.messages import ToolMessage

from agent_service.guardrails.input import normalize
from agent_service.guardrails.pii import redact_pii
from agent_service.memory import PREFERENCES_PREFIX

UNCONFIRMED = "No tengo ese dato confirmado; puedo buscarlo en el catálogo si quieres"
UNCONFIRMED_NOTICE = "Algunos montos no están confirmados; verifícalos en el catálogo"
SECRET_REPLY = "No puedo compartir información privada del sistema"
SECRETS = re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]+|Bearer\s+|\bsk-[\w-]+|\blsv2_[\w-]+")
NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?"
AMOUNTS = re.compile(rf"S/\s*({NUMBER})|(?<![\d.,])({NUMBER})\s*soles\b", re.I)
STOCK = re.compile(
    r"\bstock\s*(?:disponible\s*)?(?:de\s*|:\s*|=\s*)?(\d+)"
    r"|\b(?:hay|quedan|disponibles)\s+(\d+)\s+unidades"
    r"|\b(\d+)\s+unidades\s+(?:en stock|disponibles)",
    re.I,
)
PRICE_FIELDS = {"price_pen", "unit_price_pen", "total_pen"}


def decimal_amount(value):
    number = re.sub(r"[ \u00a0\u202f]", "", str(value))
    # Comas en grupos de tres son miles; una coma decimal se conserva como punto.
    number = re.sub(r",(?=\d{3}(?:[,\.]|$))", "", number)
    return Decimal(number.replace(",", "."))


def amounts_in(text):
    return [decimal_amount(a or b) for a, b in AMOUNTS.findall(text)]


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
    prices, stocks, unit_prices = set(), set(), set()

    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in PRICE_FIELDS:
                    try:
                        amount = decimal_amount(child)
                        if amount.is_finite():
                            prices.add(amount)
                            if key != "total_pen":
                                unit_prices.add(amount)
                    except InvalidOperation:
                        pass
                elif key == "stock" and type(child) is int:
                    stocks.add(child)
                elif isinstance(child, (dict, list)):
                    collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    for message in messages:
        if message.type == "human":
            prices.update(amounts_in(message.text))
        elif isinstance(message, ToolMessage):
            collect(structured_data(message))
        elif message.type == "system" and PREFERENCES_PREFIX in message.text:
            # Este bloque lo construye memory_prompt con recuerdos revalidados.
            raw = message.text.split(PREFERENCES_PREFIX, 1)[1]
            try:
                preferences, _ = json.JSONDecoder().raw_decode(raw)
            except ValueError:
                continue
            for preference in preferences:
                if preference["tipo"] == "presupuesto":
                    prices.update(
                        decimal_amount(match.group())
                        for match in re.finditer(NUMBER, preference["valor"])
                    )
    prices.update(price * quantity for price in unit_prices for quantity in range(1, 21))
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
    amounts = amounts_in(safe)
    quantities = [int(next(group for group in match if group)) for match in STOCK.findall(safe)]
    if any(amount not in prices for amount in amounts):
        if all(amount not in prices for amount in amounts) and not any(
            isinstance(message, ToolMessage) for message in messages
        ):
            return OutputDecision(UNCONFIRMED, "ungrounded_price", "replaced")
        safe += "\n\n" + UNCONFIRMED_NOTICE
        return OutputDecision(safe, "ungrounded_price", "annotated")
    if any(q not in stocks for q in quantities):
        return OutputDecision(
            safe + "\n\nAlgunos datos de stock no están confirmados; verifícalos en el catálogo",
            "ungrounded_price",
            "annotated",
        )
    return OutputDecision(
        safe, "pii" if safe != text else None, "redacted" if safe != text else None
    )
