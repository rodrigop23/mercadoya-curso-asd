"""Only tool definitions are cached. User credentials live in the current ToolRuntime."""

import asyncio
import logging

from langchain_mcp_adapters.client import MultiServerMCPClient

from agent_service.config import settings

_client = None
_tools = None
_lock = asyncio.Lock()
logger = logging.getLogger(__name__)


async def forward_user_jwt(request, handler):
    runtime = request.runtime
    if runtime is not None and request.name in {
        "list_my_orders",
        "get_my_order",
        "cancel_my_order",
    }:
        user = runtime.config.get("configurable", {}).get("langgraph_auth_user", {})
        token = user.get("token")
        if token:
            return await handler(request.override(headers={"Authorization": f"Bearer {token}"}))
    return await handler(request)


def client():
    global _client
    if _client is None:
        cfg = settings()
        _client = MultiServerMCPClient(
            {
                "mercadoya": {
                    "transport": "streamable_http",
                    "url": cfg.mcp_url,
                    "headers": {"X-MCP-Internal-Token": cfg.mcp_internal_token},
                    "timeout": 5,
                }
            },
            tool_interceptors=[forward_user_jwt],
            handle_tool_errors=True,
        )
    return _client


async def get_tools():
    global _tools
    if _tools is not None:
        return _tools
    async with _lock:
        if _tools is None:
            try:
                _tools = await client().get_tools()
            except Exception:
                # Do not log exception bodies, connection configuration or credentials.
                logger.warning("MCP no disponible; se reintentará en el próximo turno")
                return []
    return _tools
