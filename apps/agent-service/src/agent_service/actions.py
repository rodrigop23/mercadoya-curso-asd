"""Contrato JSON público. Ningún modelo admite credenciales ni campos extra."""

from typing import Annotated, Literal
from uuid import UUID

from langchain_core.tools import tool
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

Money = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)\.[0-9]{2}$")]
Quantity = Annotated[int, Field(strict=True, ge=1, le=20)]


class ActionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CartProposal(ActionModel):
    kind: Literal["add_to_cart"]
    action_id: UUID
    product_id: UUID
    title: str = Field(min_length=1)
    unit_price_pen: Money
    quantity: Quantity
    stock: int = Field(strict=True, ge=0)


class CancelProposal(ActionModel):
    kind: Literal["cancel_order"]
    action_id: UUID
    order_id: UUID
    status: Literal["pending"]
    total_pen: Money | None
    items_count: int = Field(strict=True, ge=0)
    created_at: str = Field(min_length=1)


class CartResult(ActionModel):
    applied: bool = Field(strict=True)
    quantity_in_cart: int | None = Field(default=None, strict=True, ge=1, le=2147483647)
    reason: Literal["stock", "cart_full", "checkout_locked", "not_found", "invalid"] | None = None


class ActionResume(ActionModel):
    action_id: UUID
    approved: bool = Field(strict=True)
    result: CartResult | None = None


Proposal = Annotated[CartProposal | CancelProposal, Field(discriminator="kind")]
proposal_adapter = TypeAdapter(Proposal)
action_adapter = TypeAdapter(CartProposal | CancelProposal | ActionResume)


@tool
async def propose_add_to_cart(product_id: UUID, quantity: Quantity) -> str:
    """Propone agregar de 1 a 20 unidades al carrito. Requiere confirmación cada vez."""
    raise RuntimeError("Solo el nodo confirm_action puede procesar propuestas")


@tool
async def propose_cancel_order(order_id: UUID) -> str:
    """Propone cancelar un pedido pendiente propio. Requiere confirmación cada vez."""
    raise RuntimeError("Solo el nodo confirm_action puede procesar propuestas")


PROPOSAL_TOOLS = [propose_add_to_cart, propose_cancel_order]
PROPOSAL_NAMES = {tool.name for tool in PROPOSAL_TOOLS}
