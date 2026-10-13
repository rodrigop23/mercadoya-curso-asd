from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Limit = Annotated[int, Field(ge=1, le=10, strict=True)]
Price = Annotated[Decimal, Field(ge=0, decimal_places=2, allow_inf_nan=False)]
Query = Annotated[str, Field(max_length=100)]
OrderStatus = Literal["pending", "confirmed", "rejected", "cancelled", "expired"]


class Product(BaseModel):
    id: str
    title: str
    description: str = Field(max_length=1000)
    price_pen: str
    stock: int
    available: bool


class ProductSummary(Product):
    description: str = Field(max_length=200)


class SearchResult(BaseModel):
    total: int
    products: list[ProductSummary]


class Stock(BaseModel):
    product_id: str
    found: bool
    title: str | None = None
    stock: int | None = None
    available: bool = False


class StockResult(BaseModel):
    products: list[Stock]


class OrderSummary(BaseModel):
    id: str
    status: OrderStatus
    created_at: str
    total_pen: str | None
    items_count: int


class OrdersResult(BaseModel):
    orders: list[OrderSummary]


class OrderItem(BaseModel):
    product_id: str
    title: str
    quantity: int
    unit_price_pen: str


class OrderDetail(BaseModel):
    id: str
    status: OrderStatus
    created_at: str
    total_pen: str | None
    items: list[OrderItem]


class CancelResult(BaseModel):
    order_id: str
    status: Literal["cancelled"]
    already_cancelled: bool
