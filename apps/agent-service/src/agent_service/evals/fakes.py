"""MCP ficticio compartido por tests y evaluaciones; nunca abre conexiones."""

import json

from langchain_core.messages import ToolMessage
from langchain_mcp_adapters.tools import convert_mcp_tool_to_langchain_tool
from mcp.types import CallToolResult, TextContent, Tool

from agent_service.mcp_tools import forward_user_jwt

PID = "00000000-0000-4000-8000-000000000001"
PRODUCT = dict(id=PID, title="Audífonos", price_pen="12.90", stock=7)
ORDER = dict(
    order_id=PID,
    status="pending",
    total_pen="25.80",
    items=[dict(quantity=2)],
    created_at="2026-10-12T10:00:00Z",
)
READ_NAMES = {"search_products", "get_product", "check_stock", "list_my_orders", "get_my_order"}
WRITE_NAMES = {"cancel_my_order", "add_to_cart"}


class FakeMCP:
    def __init__(self, fixture="default"):
        if fixture not in {"default", "empty", "unavailable"}:
            raise ValueError("Escenario MCP desconocido")
        self.fixture = fixture
        self.reads = []
        self.writes = []

    async def call(self, name, args, config):
        token = config.get("configurable", {}).get("langgraph_auth_user", {}).get("token")
        if name in WRITE_NAMES:
            self.writes.append(token)
            data = dict(order_id=PID, status="cancelled", already_cancelled=False)
        else:
            self.reads.append(token)
            data = {
                "get_product": PRODUCT,
                "search_products": {"products": [PRODUCT], "total": 1},
                "check_stock": {"products": [dict(id=PID, found=True, stock=7)]},
                "get_my_order": ORDER,
                "list_my_orders": {"orders": [ORDER]},
            }[name]
        if self.fixture == "empty":
            data = {"products": [], "orders": [], "total": 0}
        return ToolMessage(
            content=json.dumps(data),
            tool_call_id="validation",
            artifact={"structured_content": data},
        )

    def tools(self, observer):
        if self.fixture == "unavailable":
            return []

        async def transport(request, handler):
            async def respond(forwarded):
                config = request.runtime.config if request.runtime else {}
                message = await self.call(request.name, request.args, config)
                return CallToolResult(
                    content=[TextContent(type="text", text=message.text)],
                    structuredContent=message.artifact["structured_content"],
                )

            async def sanitized(forwarded):
                return await forward_user_jwt(forwarded, respond)

            return await observer(request, sanitized)

        properties = {
            "search_products": {"query": {"type": "string"}},
            "get_product": {"product_id": {"type": "string"}},
            "check_stock": {"product_ids": {"type": "array", "items": {"type": "string"}}},
            "list_my_orders": {},
            "get_my_order": {"order_id": {"type": "string"}},
            "cancel_my_order": {"order_id": {"type": "string"}},
        }
        return [
            convert_mcp_tool_to_langchain_tool(
                None,
                Tool(
                    name=name,
                    description=name,
                    inputSchema={
                        "type": "object",
                        "properties": fields,
                        "required": list(fields),
                    },
                ),
                connection={"transport": "streamable_http", "url": "http://unused/mcp"},
                tool_interceptors=[transport],
                server_name="mercadoya",
            )
            for name, fields in properties.items()
        ]
