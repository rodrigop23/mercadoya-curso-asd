# MCP de MercadoYa

Servidor Python 3.12 independiente del agente, de pnpm y de Turbo. Expone cinco
herramientas de lectura sobre las APIs públicas de Catalog y Orders y una
cancelación autenticada. No accede a Inventory ni a credenciales internas de Catalog.

## Arranque

Desde la raíz, genera `MCP_INTERNAL_TOKEN` con `openssl rand -hex 32`, guárdalo en
el `.env` de Compose y ejecuta `pnpm demo:infra` y `pnpm demo:agent`. El servidor no
carga `.env`. Compose pasa las variables y publica el MCP solo dentro de su red,
sin puerto del host ni ruta en Kong. `GET /health` es público para el healthcheck.

Para desarrollo directo, exporta las variables y ejecuta desde esta app:

```sh
uv sync --locked
export CATALOG_URL=http://localhost:3007 ORDERS_URL=http://localhost:3002
export MCP_INTERNAL_TOKEN="$(openssl rand -hex 32)"
uv run python -m mercadoya_mcp.server
```

El agente local debe recibir el mismo token interno. Defaults: `CATALOG_URL` es
`http://catalog:3007`, `ORDERS_URL` es `http://orders:3002`, `MCP_PORT` es `8080`.
El path es `/mcp`. Toda petición a MCP necesita `X-MCP-Internal-Token`; un token
vacío impide arrancar. La comparación usa `hmac.compare_digest`.

Compose usa `${MCP_INTERNAL_TOKEN:-}` porque interpola también los perfiles
apagados. Usar `:?` rompería `demo:infra` sin el perfil agent. La validación
obligatoria ocurre al arrancar el MCP, antes de abrir el puerto. El agente espera
su healthcheck antes de arrancar.

## Herramientas

Las cinco lecturas anuncian `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`
y `openWorldHint=false`. Pydantic valida entradas y publica `outputSchema`.
El SDK entrega texto JSON y `structuredContent` con los mismos datos. Una línea
breve confirma que la consulta de lectura terminó. Los errores de validación
omiten valores rechazados; los fallos inesperados no exponen excepciones.

| Herramienta | Entrada | Lectura |
| --- | --- | --- |
| `search_products` | query hasta 100 caracteres, min_price/max_price decimales no negativos, limit 1–10 | Catalog `/api/products`; máximo diez productos, total antes del límite, descripción hasta 200 caracteres |
| `get_product` | product_id UUID | Catalog GET público `/api/products/{id}`; descripción hasta 1000 caracteres |
| `check_stock` | product_ids, 1–10 UUID | El mismo GET público; `products` contiene `found=false` para ausentes |
| `list_my_orders` | status opcional, limit 1–10 | Orders `/api/orders`, luego filtro de estado y límite |
| `get_my_order` | order_id UUID | Orders `/api/orders/{id}` |

Precios y totales salen como strings decimales con dos cifras en soles PEN. Orders
entrega céntimos enteros; `money.cents_to_pen` hace la conversión con Decimal.
`items_count` suma cantidades. Pedidos históricos sin total conservan `null`, sin
inventar importes. Nunca se devuelven buyerId, información de pago o rutas internas.

Las herramientas de pedidos toman el Bearer de `Context.headers` y lo reenvían
sin cambios. Orders valida firma, issuer y audience y limita los datos al comprador.
El MCP no acepta buyerId ni decide la identidad. Sin Bearer devuelve un error de
herramienta. Los errores remotos usan mensajes fijos, nunca cuerpos o trazas.

HTTP usa httpx asíncrono, conexión de dos segundos y plazo total de cinco segundos por
operación, sin reintentos, redirects o proxies heredados. Los logs contienen solo
nombre de herramienta, duración y status remoto. Cada lectura remota produce una
entrada; check_stock puede producir varias. Sus hasta diez lecturas corren en
paralelo y conservan el orden de entrada. No se imprimen headers ni cuerpos.

## Versiones y compatibilidad

El 2026-10-12 se verificaron contra PyPI con uv las versiones solicitadas:
`mcp==2.3.0`, `langchain-mcp-adapters==0.3.2` y `mcp==1.30.0`. No hubo cambios.
El servidor usa `mcp.server.mcpserver.MCPServer`; las opciones de transporte en
2.x se pasan a `streamable_http_app`, con `stateless_http=True` y `json_response=True`.
El cliente del agente usa MCP 1.x en su propio lock. No se instalan los dos SDK
en un entorno. `tests/adapter_probe.py` corre con uv en el proyecto del agente.

El test real confirma initialize con `2025-11-25`, las seis herramientas,
annotations, outputSchema, structuredContent y llamada con adapters. El SDK 2.x
acepta ese handshake aunque también soporta la revisión stateless `2026-07-28`.
No hizo falta bajar el servidor a FastMCP 1.x.

```sh
uv sync --locked
uv run ruff check
uv run pytest
```

La integración necesita el checkout de `apps/agent-service`; uv resuelve allí su
lock. CI sincroniza ambos entornos antes del test. El smoke completo, sin claves,
se ejecuta en el agente con `uv run python scripts/smoke.py --tools`.

Referencias: [SDK Python y migración v2](https://py.sdk.modelcontextprotocol.io/v2/migration/),
[transporte 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
[cambios 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
[adapters](https://docs.langchain.com/oss/python/langchain/mcp).
La autorización OAuth de MCP no se usa para este servidor interno. Véase
[ADR 0025](../../docs/adr/0025-herramientas-mcp-lectura.md).


## Cancelación aprobada

`cancel_my_order(order_id: UUID)` hace un POST sin cuerpo a
`/api/orders/{order_id}/cancel` con el Bearer de Context.headers. Devuelve
`{ order_id, status: "cancelled", already_cancelled }`: 202 cancela ahora y 200
informa una cancelación previa. Sus anotaciones son readOnlyHint=false,
destructiveHint=true, idempotentHint=true y openWorldHint=false.

El agente nunca enlaza esta herramienta al modelo. La llama solo después de una
aprobación humana y con el JWT del request que reanuda. El MCP exige además el
token interno de proceso. 409 indica pedido finalizado o pago en proceso; 404 no
revela si existe un pedido ajeno. 401 y fallos 5xx/timeout usan mensajes fijos.
No hay reintentos; los logs conservan únicamente nombre, duración y status.
Los tests cubren 200, 202, 400, 401, 404, 409, 502, 503 y timeout, incluidos headers
por llamada y ausencia de JWT en logs. Véase el
[ADR 0026](../../docs/adr/0026-acciones-con-confirmacion.md).
