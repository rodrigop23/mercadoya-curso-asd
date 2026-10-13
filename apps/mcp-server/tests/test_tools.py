import asyncio
import logging
from types import SimpleNamespace

import httpx
import pytest
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import TypeAdapter, ValidationError

from mercadoya_mcp import clients
from mercadoya_mcp.errors import remote_error
from mercadoya_mcp.money import cents_to_pen
from mercadoya_mcp.server import ReadingServer
from mercadoya_mcp.tools import register
from mercadoya_mcp.tools.schemas import Price


def test_money():
    assert cents_to_pen(1) == "0.01"
    assert cents_to_pen(15000) == "150.00"
    assert cents_to_pen(12345) == "123.45"


@pytest.mark.parametrize(
    "status,text",
    [
        (400, "Filtros inválidos"),
        (401, "Tu sesión venció"),
        (404, "No encontré ese pedido entre los tuyos"),
        (500, "El servicio de Orders no está disponible ahora"),
        (None, "El servicio de Orders no está disponible ahora"),
    ],
)
def test_errors(status, text):
    assert text in str(remote_error("Orders", status))


@pytest.mark.parametrize("status", [200, 400, 401, 404, 503, None])
def test_http_mapping_and_logs(monkeypatch, caplog, status):
    secret = "private-jwt-never-log"

    async def fake_get(_self, method, url, **kwargs):
        assert kwargs["headers"] == {"Authorization": f"Bearer {secret}"}
        if status is None:
            raise httpx.ReadTimeout(secret)
        return httpx.Response(
            status, json={"orders": [], "error": secret}, request=httpx.Request("GET", url)
        )

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_get)
    caplog.set_level(logging.INFO)
    if status == 200:
        asyncio.run(
            clients.get("list_my_orders", "Orders", "/api/orders", authorization=f"Bearer {secret}")
        )
    else:
        with pytest.raises(ToolError) as error:
            asyncio.run(
                clients.get(
                    "list_my_orders", "Orders", "/api/orders", authorization=f"Bearer {secret}"
                )
            )
        assert secret not in str(error.value)
    assert "tool=list_my_orders" in caplog.text
    assert secret not in caplog.text and "Bearer" not in caplog.text


def test_missing_auth():
    with pytest.raises(ToolError, match="Necesitas iniciar sesión"):
        clients.user_authorization(SimpleNamespace(headers={}))


def test_truncation_limits_stock_and_private_fields(monkeypatch):
    async def fake_get(tool, service, path, **kwargs):
        if path.endswith("00000000-0000-4000-8000-000000000002"):
            raise remote_error("Catalog", 404)
        p = dict(
            id="00000000-0000-4000-8000-000000000001",
            title="Producto",
            description="x" * 1200,
            price=123.45,
            stock=0,
            internal="secret",
        )
        return {"product": p, "products": [p] * 20}

    monkeypatch.setattr("mercadoya_mcp.tools.get", fake_get)
    server = MCPServer("test")
    register(server)

    async def run():
        search = await server.call_tool("search_products", {"limit": 10})
        assert len(search.structured_content["products"]) == 10
        assert len(search.structured_content["products"][0]["description"]) == 200
        pid = "00000000-0000-4000-8000-000000000001"
        product = await server.call_tool("get_product", {"product_id": pid})
        assert len(product.structured_content["description"]) == 1000
        assert not product.structured_content["available"]
        assert "internal" not in product.structured_content
        stock = await server.call_tool(
            "check_stock", {"product_ids": [pid, "00000000-0000-4000-8000-000000000002"]}
        )
        assert stock.structured_content["products"][1]["found"] is False
        with pytest.raises(ToolError):
            await server.call_tool("search_products", {"min_price": "20", "max_price": "10"})
        for args in (
            {"limit": 11},
            {"min_price": "-1"},
            {"max_price": "1.234"},
            {"query": "x" * 101},
        ):
            with pytest.raises(ToolError):
                await server.call_tool("search_products", args)

    asyncio.run(run())


def test_safe_validation_and_unexpected_errors(monkeypatch, caplog):
    async def bad_upstream(*args, **kwargs):
        raise ValueError("Bearer secret-jwt-private-body")

    monkeypatch.setattr("mercadoya_mcp.tools.get", bad_upstream)
    server = ReadingServer("test")
    register(server)

    async def run():
        with pytest.raises(ToolError, match="Filtros inválidos"):
            await server.call_tool("search_products", {"limit": "secret-jwt"})
        with pytest.raises(ToolError, match="El servicio de Catalog no está disponible ahora"):
            await server.call_tool("search_products", {})

    asyncio.run(run())
    assert "secret-jwt" not in caplog.text and "Bearer" not in caplog.text


def test_order_projection_filter_and_money(monkeypatch):
    headers = []
    oid = "00000000-0000-4000-8000-000000000001"
    order = dict(
        id=oid,
        status="confirmed",
        createdAt="2026-10-12T10:00:00Z",
        totalAmount=12345,
        buyerId="private-buyer",
        checkoutUrl="private-payment",
        items=[dict(productId=oid, title="Audífonos", quantity=3, unitAmount=4115)],
    )

    async def fake_get(tool, service, path, **kwargs):
        headers.append(kwargs["authorization"])
        return {"orders": [dict(order, status="pending"), order] * 10, "order": order}

    monkeypatch.setattr("mercadoya_mcp.tools.get", fake_get)
    server = ReadingServer("test")
    register(server)
    context = SimpleNamespace(headers={"authorization": "Bearer token-orders"})

    async def run():
        result = await server.call_tool(
            "list_my_orders", {"status": "confirmed", "limit": 1}, context
        )
        orders = result.structured_content["orders"]
        assert len(orders) == 1 and orders[0]["total_pen"] == "123.45"
        assert orders[0]["items_count"] == 3
        detail = await server.call_tool("get_my_order", {"order_id": oid}, context)
        assert detail.structured_content["items"][0]["unit_price_pen"] == "41.15"
        assert "buyerId" not in detail.structured_content
        assert "checkoutUrl" not in detail.structured_content

    asyncio.run(run())
    assert headers == ["Bearer token-orders"] * 2


def test_missing_internal_token_fails_before_listen(monkeypatch):
    from mercadoya_mcp.server import create_app

    monkeypatch.delenv("MCP_INTERNAL_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="MCP_INTERNAL_TOKEN es obligatorio"):
        create_app()


@pytest.mark.parametrize("value", ["150.00", 150, 99.90, "1e2"])
def test_decimal_price(value):
    assert TypeAdapter(Price).validate_python(value) >= 0


@pytest.mark.parametrize("value", [-1, "-1", 1.234, "NaN", "Infinity"])
def test_invalid_decimal_price(value):
    with pytest.raises(ValidationError):
        TypeAdapter(Price).validate_python(value)


@pytest.mark.parametrize("status", [200, 202, 400, 401, 404, 409, 502, 503, None])
def test_cancel_http_no_retries_and_private_logs(monkeypatch, caplog, status):
    calls = []
    secret = "secret-cancel-jwt"
    oid = "00000000-0000-4000-8000-000000000001"

    async def fake_request(_self, method, url, **kwargs):
        calls.append(method)
        assert method == "POST" and url.endswith(f"/{oid}/cancel")
        assert kwargs["headers"] == {"Authorization": f"Bearer {secret}"}
        assert "json" not in kwargs and "data" not in kwargs
        if status is None:
            raise httpx.ReadTimeout(secret)
        return httpx.Response(
            status, json={"order": dict(id=oid, status="cancelled"), "error": secret}
        )

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_request)
    caplog.set_level(logging.INFO)
    server = ReadingServer("test")
    register(server)
    context = SimpleNamespace(headers={"authorization": f"Bearer {secret}"})

    async def run():
        if status in (200, 202):
            result = await server.call_tool("cancel_my_order", {"order_id": oid}, context)
            assert result.structured_content == dict(
                order_id=oid, status="cancelled", already_cancelled=status == 200
            )
        else:
            with pytest.raises(ToolError) as error:
                await server.call_tool("cancel_my_order", {"order_id": oid}, context)
            assert secret not in str(error.value)
            if status == 409:
                assert "ya no se puede cancelar" in str(error.value)
            if status == 404:
                assert "No encontré ese pedido entre los tuyos" in str(error.value)

    asyncio.run(run())
    assert calls == ["POST"]
    assert secret not in caplog.text and "Bearer" not in caplog.text
