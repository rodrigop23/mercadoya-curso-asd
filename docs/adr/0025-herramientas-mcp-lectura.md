# 0025: Herramientas MCP de solo lectura

- Estado: aceptado
- Fecha: 2026-10-12

## Contexto

El grafo del Agent Server conversaba sin consultar productos ni pedidos. Necesita
datos reales y aislamiento por comprador. El JWT dura cinco minutos y se recibe
en la configuración autenticada del request; no debe persistir ni llegar al modelo.

Catalog no ofrecía detalle público. Se agrega `GET /api/products/{id}` con UUID,
200 `{ product }`, 400, 404 y 503. OpenAPI pasa de 1.4.0 a 1.5.0. La ruta GET ya
está cubierta por `catalog-public`; Kong conserva su configuración.

## Decisión

Las lecturas viven en un servidor MCP separado, en lugar de incrustar los clientes
HTTP del negocio en el grafo. MCP publica schemas, annotations y resultados
estructurados y permite reutilizar las herramientas con otros clientes. El grafo
se ocupa de la conversación y el bucle de consultas. Este límite añade un proceso
y una llamada HTTP, a cambio de un contrato independiente y comprobable.

El servidor es Python 3.12 con uv, ruff y pytest, como el agente. Solo adapta
lecturas HTTP y no comparte código TypeScript con los servicios. Se fija
`mcp==2.3.0` y se usa `MCPServer`, nombre nuevo de FastMCP en 2.x.

Streamable HTTP expone `/mcp` con `stateless_http=True` y `json_response=True`.
No conserva sesiones de usuario ni requiere `Mcp-Session-Id`. El agente usa
`langchain-mcp-adapters==0.3.2`, que exige MCP menor que 2, y fija `mcp==1.30.0`.
Los proyectos tienen pyproject y locks separados. El test de integración corre el
cliente real 1.x en el entorno del agente y el servidor 2.x en otro proceso.
Confirma negociación de `2025-11-25` mediante initialize, tools/list con cinco
herramientas, readOnlyHint, outputSchema y resultado estructurado. El SDK 2.x
admite también `2026-07-28`. No se necesitó el fallback FastMCP 1.30.

El MCP está solo en la red de Compose, sin ruta de Kong ni puerto del host.
`X-MCP-Internal-Token` identifica al proceso llamador y se compara en tiempo
constante en cada petición MCP. No se usa OAuth 2.1 para este servicio interno.
`GET /health` queda fuera de ese control. Un token interno ausente impide arrancar.
Compose interpola perfiles inactivos, por eso usa `${MCP_INTERNAL_TOKEN:-}` y
valida al arrancar en lugar de `:?`. Así `demo:infra` sigue sin exigir secretos del
perfil agent. El health obligatorio evita arrancar el agente sin un MCP configurado.

La identidad del comprador se transporta aparte. El interceptor lee el JWT del
`ToolRuntime.config.configurable.langgraph_auth_user` de la llamada actual y lo
agrega solo a los headers de las herramientas de pedidos. El cliente por proceso
conserva únicamente configuración del MCP y la lista de herramientas. Ningún
JWT se guarda en cliente, caché, estado, metadata o argumentos. El modelo recibe
solo callbacks. Una prueba con tracer local verifica también los inputs y metadata
de los runs completos, incluyendo tools, sin JWT o Bearer.

El MCP reenvía el Bearer tal cual a Orders; Orders valida el JWT y filtra al dueño.
No hay buyerId como argumento y un pedido ajeno responde con el mismo mensaje que
uno inexistente. Se usa transporte directo a `catalog:3007` y `orders:3002`, cuyos
servicios ya verifican los JWT. Evita un salto por Kong y mantiene el MCP privado.
Las lecturas de producto y stock usan el GET público de Catalog, sin token de stock
ni rutas internas. Inventory queda fuera: guarda reservas, no stock por producto.

Cinco herramientas, todas de lectura: search_products, get_product, check_stock,
list_my_orders y get_my_order. check_stock devuelve una colección bajo `products`
para que el outputSchema tenga raíz objeto. Los precios PEN tienen dos decimales;
los céntimos de Orders se convierten con un helper Decimal. Los datos de pago y
buyerId se excluyen. Los pedidos históricos sin importe conservan null.

El grafo usa StateGraph, ToolNode y tools_condition, con seis iteraciones de
herramientas por turno. Al agotarlas, el modelo responde con lo consultado sin
herramientas enlazadas. La carga es perezosa, no abre conexiones al importar y
reintenta en el próximo turno si MCP no respondió. Los fallos de transporte no
interrumpen el run: se convierten en mensajes útiles sin trazas crudas.

El endpoint `/mcp` del Agent Server conserva `disable_mcp: true`: expone el grafo
hacia afuera y no es el cliente de estas herramientas. No hay interrupt,
confirmaciones ni herramientas de mutación, ni siquiera deshabilitadas.

## Consecuencias y verificación

El perfil agent añade el servidor MCP y healthchecks de Catalog y Orders.
`demo:agent` construye ambas imágenes y espera MCP sano. La web anuncia las
consultas pendientes sin mostrar ToolMessages o argumentos. El proveedor
scripted permite probar el bucle con comandos `/tool nombre {json}` sin API keys;
echo conserva su comportamiento. La suite de saga debe usar NATS dedicado;
rechaza el endpoint del `.env` local antes de publicar eventos para impedir
activar Notifications del stack de demostración. El modo stub se fija en las
pruebas; la configuración de correo de la aplicación se conserva.

CI sincroniza ambos locks, ejecuta ruff y pytest y corre los smokes echo y MCP.
El smoke crea stubs locales de Catalog, Orders y JWKS RSA, comprueba JWT exacto
por comprador, pedido ajeno, error ToolMessage, 401 sin token interno y ausencia
de JWT en estados y logs de ambos procesos. Las pruebas del grafo verifican el
runtime por llamada y el límite por turno.

La carga completa de Catalog y Orders sigue sin paginación en sus APIs. MCP limita
la salida a diez elementos, pero el servicio remoto aún envía toda la colección.
El plazo total de cinco segundos se aplica a cada operación HTTP, con connect de
dos segundos; check_stock hace hasta diez lecturas en paralelo y conserva el orden. No se introduce caché de datos o reintentos con JWT.

Referencias: [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
[transporte](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[autorización](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[SDK v2](https://py.sdk.modelcontextprotocol.io/v2/migration/),
[adapters](https://reference.langchain.com/python/langchain-mcp-adapters/client/MultiServerMCPClient),
[ToolNode](https://docs.langchain.com/oss/python/langgraph/use-tools) y
[Agent Server MCP](https://docs.langchain.com/langsmith/server-mcp).
