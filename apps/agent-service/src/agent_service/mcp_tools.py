"""Only tool definitions are cached. User credentials live in the current ToolRuntime."""

import asyncio
import logging

from langchain_core.messages import ToolMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from mcp.types import CallToolResult, TextContent

from agent_service.config import settings
from agent_service.guardrails.tool import sanitize_tool_message

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
            request = request.override(headers={"Authorization": f"Bearer {token}"})
    result = await handler(request)
    config = runtime.config if runtime is not None else {}
    # Redacta dentro del interceptor, antes de que el adapter emita callbacks de la tool.
    if isinstance(result, CallToolResult):
        message = ToolMessage(
            content=[
                {"type": "text", "text": block.text}
                for block in result.content
                if isinstance(block, TextContent)
            ],
            tool_call_id="sanitized",
            artifact={"structured_content": result.structuredContent},
        )
        safe = sanitize_tool_message(message, config)
        return CallToolResult(
            content=[TextContent(type="text", text=safe.text)],
            structuredContent=safe.artifact["structured_content"],
            isError=result.isError,
        )
    if isinstance(result, ToolMessage):
        return sanitize_tool_message(result, config)
    return result


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
