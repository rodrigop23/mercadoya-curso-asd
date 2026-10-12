from mcp.server.mcpserver.exceptions import ToolError


def remote_error(service: str, status: int | None) -> ToolError:
    if status == 400:
        return ToolError("Filtros inválidos: revisa los parámetros de la consulta")
    if status in (401, 403):
        return ToolError("Tu sesión venció, vuelve a iniciar sesión")
    if status == 404:
        return ToolError(
            "No encontré ese pedido entre los tuyos"
            if service == "Orders"
            else "Producto no encontrado"
        )
    return ToolError(f"El servicio de {service} no está disponible ahora")
