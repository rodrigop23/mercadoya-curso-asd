"""Redacción local. No conserva coincidencias ni necesita servicios externos."""

import re

EMAIL = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.UNICODE)
CARD = re.compile(r"(?<![\w.-])\d(?:[ -]?\d){12,18}(?![\w.-])")
PHONE = re.compile(r"(?<![\w.-])(?:\+?51[ -]?)?9\d{2}[ -]?\d{3}[ -]?\d{3}(?![\w.-])")
DNI = re.compile(r"(?<![\w.+-])\d{8}(?![\w.-])")
MARKERS = re.compile(r"\[(?:correo|teléfono|dni|tarjeta)\]")


def luhn(number: str) -> bool:
    digits = [int(digit) for digit in number if digit.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2:
            digit *= 2
            digit = digit - 9 if digit > 9 else digit
        total += digit
    return total % 10 == 0


def redact_pii(text: str) -> str:
    text = EMAIL.sub("[correo]", text)
    text = CARD.sub(lambda match: "[tarjeta]" if luhn(match[0]) else match[0], text)
    text = PHONE.sub("[teléfono]", text)

    def redact_dni(match):
        # Los números identificados explícitamente como pedido/cantidad/precio no son DNI.
        prefix = text[max(0, match.start() - 40) : match.start()]
        if re.search(
            r"(?:pedido|order|cantidad|stock|precio|S/|soles)\s*(?:n[°ºo.]?\s*)?[#:]?\s*$",
            prefix,
            re.IGNORECASE,
        ):
            return match[0]
        return "[dni]"

    return DNI.sub(redact_dni, text)


def contains_pii(text: str) -> bool:
    # También rechaza valores ya redactados en el límite HTTP o por el modelo.
    return redact_pii(text) != text or bool(MARKERS.search(text))
