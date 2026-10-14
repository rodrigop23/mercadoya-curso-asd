import asyncio
import logging
import os
import time

import httpx
from mcp.server.mcpserver.exceptions import ToolError

from mercadoya_mcp.errors import remote_error

logger = logging.getLogger("mercadoya_mcp.tools")


async def _request(method, tool, service, path, *, params=None, authorization=None):
    base = (
        os.getenv("CATALOG_URL", "http://catalog:3007")
        if service == "Catalog"
        else os.getenv("ORDERS_URL", "http://orders:3002")
    )
    started = time.monotonic()
    status = None
    try:
        # No retries, redirects, inherited proxy or shared headers/credentials.
        async with (
            asyncio.timeout(5),
            httpx.AsyncClient(timeout=httpx.Timeout(5, connect=2), trust_env=False) as client,
        ):
            response = await client.request(
                method,
                base + path,
                params=params,
                headers={"Authorization": authorization} if authorization else {},
            )
        status = response.status_code
        if not response.is_success:
            raise remote_error(service, status)
        return response.status_code, response.json()
    except (httpx.HTTPError, ValueError, TimeoutError):
        raise remote_error(service, None) from None
    finally:
        logger.info(
            "tool=%s duration_ms=%d remote_status=%s",
            tool,
            (time.monotonic() - started) * 1000,
            status,
        )


async def get(tool: str, service: str, path: str, *, params=None, authorization=None):
    _, body = await _request("GET", tool, service, path, params=params, authorization=authorization)
    return body


async def post(tool: str, service: str, path: str, *, authorization=None):
    return await _request("POST", tool, service, path, authorization=authorization)


def user_authorization(ctx):
    value = (ctx.headers or {}).get("authorization", "")
    if not value.startswith("Bearer ") or not value[7:].strip():
        raise ToolError("Necesitas iniciar sesión para ver tus pedidos")
    return value
