import asyncio
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from mercadoya_mcp.clients import get, post, user_authorization
from mercadoya_mcp.money import cents_to_pen
from mercadoya_mcp.tools.schemas import (
    CancelResult,
    Limit,
    OrderDetail,
    OrderItem,
    OrdersResult,
    OrderStatus,
    OrderSummary,
    Price,
    Product,
    ProductSummary,
    Query,
    SearchResult,
    Stock,
    StockResult,
)

ANNOTATIONS = ToolAnnotations(
    readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False
)


def product_data(raw, length=1000):
    return dict(
        id=raw["id"],
        title=raw["title"],
        description=raw["description"][:length],
        price_pen=format(Decimal(str(raw["price"])), ".2f"),
        stock=raw["stock"],
        available=raw["stock"] > 0,
    )


def order_data(raw):
    return dict(
        id=raw["id"],
        status=raw["status"],
        created_at=raw["createdAt"],
        total_pen=cents_to_pen(raw["totalAmount"]) if raw.get("totalAmount") is not None else None,
    )


def register(server: MCPServer):
    @server.tool(annotations=ANNOTATIONS)
    async def search_products(
        query: Query | None = None,
        min_price: Price | None = None,
        max_price: Price | None = None,
        limit: Limit = 5,
    ) -> SearchResult:
        """Busca productos del catálogo con precios en soles PEN; devuelve hasta diez resultados."""
        if min_price is not None and max_price is not None:
            if Decimal(min_price) > Decimal(max_price):
                raise ToolError("Filtros inválidos: min_price no debe superar max_price")
        params = {
            k: v
            for k, v in dict(
                q=query,
                minPrice=format(min_price, ".2f") if min_price is not None else None,
                maxPrice=format(max_price, ".2f") if max_price is not None else None,
            ).items()
            if v is not None
        }
        raw = await get("search_products", "Catalog", "/api/products", params=params)
        return SearchResult(
            total=len(raw["products"]),
            products=[ProductSummary(**product_data(p, 200)) for p in raw["products"][:limit]],
        )

    @server.tool(annotations=ANNOTATIONS)
    async def get_product(product_id: UUID) -> Product:
        """Consulta un producto por su id público; precio en soles y stock actual."""
        raw = await get("get_product", "Catalog", f"/api/products/{product_id}")
        return Product(**product_data(raw["product"]))

    @server.tool(annotations=ANNOTATIONS)
    async def check_stock(
        product_ids: Annotated[list[UUID], Field(min_length=1, max_length=10)],
    ) -> StockResult:
        """Consulta stock de uno a diez productos del catálogo. No consulta reservas."""

        async def lookup(pid):
            try:
                raw = await get("check_stock", "Catalog", f"/api/products/{pid}")
            except ToolError as error:
                if str(error) != "Producto no encontrado":
                    raise
                return Stock(product_id=str(pid), found=False)
            p = raw["product"]
            return Stock(
                product_id=str(pid),
                found=True,
                title=p["title"],
                stock=p["stock"],
                available=p["stock"] > 0,
            )

        return StockResult(products=await asyncio.gather(*(lookup(pid) for pid in product_ids)))

    @server.tool(annotations=ANNOTATIONS)
    async def list_my_orders(
        ctx: Context,
        status: OrderStatus | None = None,
        limit: Limit = 5,
    ) -> OrdersResult:
        """Lista solo tus pedidos, del más reciente al más antiguo, con importes en soles."""
        raw = await get(
            "list_my_orders", "Orders", "/api/orders", authorization=user_authorization(ctx)
        )
        orders = [o for o in raw["orders"] if status is None or o["status"] == status]
        return OrdersResult(
            orders=[
                OrderSummary(
                    **order_data(o),
                    items_count=sum(item["quantity"] for item in o.get("items") or [])
                    or o.get("quantity", 0),
                )
                for o in orders[:limit]
            ]
        )

    @server.tool(annotations=ANNOTATIONS)
    async def get_my_order(ctx: Context, order_id: UUID) -> OrderDetail:
        """Consulta el detalle de uno de tus pedidos. Un id ajeno devuelve no encontrado."""
        raw = await get(
            "get_my_order",
            "Orders",
            f"/api/orders/{order_id}",
            authorization=user_authorization(ctx),
        )
        o = raw["order"]
        return OrderDetail(
            **order_data(o),
            items=[
                OrderItem(
                    product_id=i["productId"],
                    title=i["title"],
                    quantity=i["quantity"],
                    unit_price_pen=cents_to_pen(i["unitAmount"]),
                )
                for i in o.get("items") or []
            ],
        )

    @server.tool(
        annotations=ToolAnnotations(
            readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False
        )
    )
    async def cancel_my_order(ctx: Context, order_id: UUID) -> CancelResult:
        """Cancela un pedido propio pendiente. Usar solo tras la aprobación del comprador."""
        status, raw = await post(
            "cancel_my_order",
            "Orders",
            f"/api/orders/{order_id}/cancel",
            authorization=user_authorization(ctx),
        )
        return CancelResult(
            order_id=raw["order"]["id"],
            status=raw["order"]["status"],
            already_cancelled=status == 200,
        )
