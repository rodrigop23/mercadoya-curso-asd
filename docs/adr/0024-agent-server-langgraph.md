# 0024: Agente de compras con LangGraph Agent Server

Estado: aceptado. Fecha: 2026-10-12.

## Decisión

`apps/agent-service` es un servicio Python 3.12 servido con la imagen oficial
`langchain/langgraph-api:0.16.0-py3.12`. El CLI construye esa imagen a partir de
`langgraph.json`, con `api_version: "0.16.0"`. El servicio no lleva `package.json`
ni participa en pnpm o Turbo.

El Agent Server usa Redis 6 y una DB dedicada `agent_server` en el Postgres 18
existente. Un init idempotente con `psql` crea el rol y la DB sobre volúmenes
existentes. El servidor gestiona los hilos, los runs y el checkpointer; el grafo no
implementa persistencia propia. El perfil opcional `agent` evita que el stack habitual
o el smoke de identity necesiten claves de IA.

Kong publica `/api/agent` con `strip_path: true` e `identity-auth`. `/api/agent/ok`
es público. La cookie de sesión se convierte en Bearer dentro de Kong. El servicio
verifica RS256 contra el JWKS de identity con las mismas reglas de
`packages/jwt-verifier`. La auth propia devuelve identity, role y token. `@auth.on`
fuerza `metadata.owner` y aplica ese filtro a los recursos para aislar compradores.
Las credenciales inválidas dan 401; un fallo de conexión al JWKS da 5xx.

La web monta un chat solo con sesión y usa `useStream` de `@langchain/react` 1.2.3,
SSE y fetch con cookie, sobre el `API_BASE_URL` de Kong. No maneja el JWT. El render
extrae solo bloques de texto de Responses API. El modelo `gpt-6-luna` y su effort
se configuran por entorno; el cliente se crea dentro del nodo. Sin clave OpenAI,
el grafo devuelve un mensaje en español sin impedir el arranque.

El CI usa `langgraph dev`, con CLI 0.4.33 y API 0.16.0 fijados, un modelo eco y un
JWKS RSA local. No necesita secretos. Comprueba health, autenticación, runs,
aislamiento por owner y la respuesta 5xx cuando falla el JWKS.

El token llega al grafo solo mediante `config["configurable"]["langgraph_auth_user"]`.
Las futuras acciones deben leerlo dentro del nodo de confirmación, después de
`interrupt`. Al reanudar, ese nodo recibe el usuario del request nuevo y los nodos
anteriores no vuelven a ejecutarse. No se guarda el token en state, metadata o logs.
El grafo base todavía no tiene interrupts ni acciones.

## Alternativas descartadas

Un FastAPI propio obligaría a implementar el protocolo de streaming, los hilos,
los interrupts y la persistencia. El Agent Server ya ofrece esas operaciones.

`langgraph dev` como runtime local del producto no persiste en Postgres. Se reserva
para el smoke sin claves y para pruebas; el perfil de Compose usa la imagen oficial.

## Límites

El modo lite es solo para uso local. Requiere una `LANGSMITH_API_KEY` válida y salida
a internet al arrancar, incluso con modelo eco. Sin ellas la imagen falla al verificar
la licencia. Producción requiere licencia, como indica la
[documentación standalone](https://docs.langchain.com/langsmith/deploy-standalone-server).

El JWT dura cinco minutos. Leerlo después de `interrupt` evita usar el token del run
original cuando una confirmación tarda más que su vigencia.

La versión mínima del protocolo v1 de `@langchain/react` no está documentada.
La versión fijada de servidor es 0.16.0, validada en el spike con Kong y cookie.

El servidor crea tablas propias en su DB, incluida `store` aunque `disable_store`
esté activo. Redis conserva su volumen y Postgres 18 mantiene el montaje en
`/var/lib/postgresql`. El CI no prueba la imagen ni su persistencia en Postgres.

El asistente solo conversa. No accede al catálogo o al stock, no modifica carrito
o pedidos, ni incluye MCP, acciones con confirmación, memoria de largo plazo o
multiagente. Las trazas usan exclusivamente las variables de LangSmith.
