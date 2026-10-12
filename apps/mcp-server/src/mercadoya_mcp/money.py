from decimal import Decimal


def cents_to_pen(cents: int) -> str:
    return format((Decimal(cents) / Decimal(100)).quantize(Decimal("0.01")), ".2f")
