"""Runs in agent-service's independent MCP 1.x environment, against MCP 2.x."""

import asyncio
import json
import sys

from langchain_mcp_adapters.client import MultiServerMCPClient
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

EXPECTED = {"search_products", "get_product", "check_stock", "list_my_orders", "get_my_order"}


async def main():
    url = sys.argv[1] + "/mcp"
    headers = {"X-MCP-Internal-Token": "integration-secret"}
    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            initialized = await session.initialize()
            assert initialized.protocolVersion == "2025-11-25"
            tools = (await session.list_tools()).tools
            assert {tool.name for tool in tools} == EXPECTED
            assert all(tool.annotations.readOnlyHint and tool.outputSchema for tool in tools)
            result = await session.call_tool("search_products", {"query": "audifonos"})
            assert not result.isError
            assert len(result.content) == 1
            assert json.loads(result.content[0].text) == result.structuredContent
            assert result.structuredContent["total"] == 12
            assert len(result.structuredContent["products"]) == 5
            assert len(result.structuredContent["products"][0]["description"]) == 200
            invalid = await session.call_tool("search_products", {"limit": 11})
            assert invalid.isError and "Filtros inválidos" in invalid.content[0].text
            missing = await session.call_tool("list_my_orders", {})
            assert missing.isError and "Necesitas iniciar sesión" in missing.content[0].text
    client = MultiServerMCPClient(
        {
            "mercadoya": {
                "transport": "streamable_http",
                "url": url,
                "headers": headers,
            }
        }
    )
    tools = await client.get_tools()
    assert {tool.name for tool in tools} == EXPECTED
    result = await next(t for t in tools if t.name == "search_products").ainvoke({"limit": 10})
    assert "Audífonos" in json.dumps(result, ensure_ascii=False)
    print("MCP 1.30 / adapters 0.3.2 → server 2.3: OK")


asyncio.run(main())
