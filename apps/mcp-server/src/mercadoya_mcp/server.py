import hmac
import logging
import os

import uvicorn
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError, UnexpectedToolError
from pydantic import ValidationError
from starlette.responses import JSONResponse
from starlette.routing import Route

from mercadoya_mcp.tools import register


class ReadingServer(MCPServer):
    async def call_tool(self, name, arguments, context=None):
        try:
            result = await super().call_tool(name, arguments, context)
        except ToolError as error:
            if isinstance(error.__cause__, ValidationError):
                raise ToolError("Filtros inválidos: revisa los parámetros de la consulta") from None
            if not isinstance(error, UnexpectedToolError):
                raise
            service = (
                "Orders"
                if name in {"list_my_orders", "get_my_order", "cancel_my_order"}
                else "Catalog"
            )
            raise ToolError(f"El servicio de {service} no está disponible ahora") from None
        except Exception:
            raise ToolError("El servicio de consultas no está disponible ahora") from None
        return result


class InternalAccess:
    def __init__(self, app, token):
        self.app = app
        self.token = token.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] != "/health":
            headers = dict(scope.get("headers", []))
            supplied = headers.get(b"x-mcp-internal-token", b"")
            if not hmac.compare_digest(supplied, self.token):
                await JSONResponse({"error": "Unauthorized"}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def create_app():
    token = os.getenv("MCP_INTERNAL_TOKEN", "")
    if not token:
        raise RuntimeError("MCP_INTERNAL_TOKEN es obligatorio")
    server = ReadingServer("mercadoya-lectura")
    register(server)
    app = server.streamable_http_app(
        streamable_http_path="/mcp", stateless_http=True, json_response=True, host="0.0.0.0"
    )

    async def health(_request):
        return JSONResponse({"ok": True})

    app.routes.append(Route("/health", health))
    return InternalAccess(app, token)


def main():
    logging.basicConfig(level=logging.INFO, format="%(name)s %(message)s")
    # HTTP libraries must never dump headers or Orders bodies even with tracing enabled elsewhere.
    for name in ("httpx", "httpcore", "mcp"):
        logging.getLogger(name).setLevel(logging.WARNING)
    uvicorn.run(
        create_app(),
        host="0.0.0.0",
        port=int(os.getenv("MCP_PORT", "8080")),
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
