# Asistente de compras de MercadoYa

Servicio Python 3.12, separado de pnpm y Turbo. El grafo `agent` solo conversa en
español. No consulta catálogo o stock, no modifica carrito o pedidos y no incluye
herramientas, MCP, confirmaciones, memoria de largo plazo ni multiagente.

## Arranque local con Postgres

Desde la raíz del repo, primero levanta el stack habitual con `pnpm demo:infra`.
Configura una `LANGSMITH_API_KEY` válida en el entorno de Compose o en tu `.env`.
`OPENAI_API_KEY` permite respuestas del modelo; sin ella el nodo devuelve un mensaje
claro en español. No se construye ningún cliente OpenAI al importar el grafo.

```sh
pnpm demo:agent
curl --fail http://localhost:8000/api/agent/ok
```

`demo:agent` construye la imagen, levanta `agent-service` y sus dependencias del perfil
`agent`, espera su health y reinicia Kong. Requiere Docker y uv. El comando de build
equivalente, desde este directorio, fija también el Python del CLI:

```sh
uvx --python 3.12 --from langgraph-cli==0.4.33 \
  langgraph build -t mercadoya-agent-service:local
```

`api_version: "0.16.0"` y `python_version: "3.12"` seleccionan exactamente la imagen
`langchain/langgraph-api:0.16.0-py3.12`. Compose no vuelve a construirla con un
Dockerfile alternativo. El puerto directo es `127.0.0.1:8123`; la web usa Kong en
`http://localhost:8000/api/agent`. `/ok` es público. Los demás endpoints requieren
el JWT que `identity-auth` obtiene de la cookie y reenvía como Bearer.

`redis` e `agent-db-init` también tienen el perfil `agent`. El stack sin perfil,
`demo:infra` y `identity-gateway-smoke` no necesitan claves de IA. Kong no depende
del agente: arranca aunque falte su DNS. El health del agente responde 5xx mientras
esté apagado; una solicitud protegida sin sesión sigue respondiendo 401.

Para apagar solo el agente, usa `docker compose --profile agent stop agent-service redis`.
No borres los volúmenes si quieres conservar los hilos. Para aplicar una nueva
versión de `kong.yml`, usa `docker compose restart kong`. `kong reload` no vuelve
a cargar el declarativo en este stack DB-less.

## Variables

Compose inyecta las variables. `langgraph.json` no carga ningún `.env`.

- `DATABASE_URI`: DB dedicada `agent_server`, con rol `agent_server`, en Postgres 18.
- `AGENT_DB_PASSWORD`: password del rol. El default local es `agent_server_local`.
  El init usa el password literal. Si contiene caracteres reservados de URI, define
  además `AGENT_DATABASE_URI` con el password codificado para `DATABASE_URI`.
- `REDIS_URI`: `redis://redis:6379`.
- `JWKS_URL`: `http://identity:3006/api/auth/jwks` en Docker.
- `JWT_ISSUER`: `http://localhost:8000`; `JWT_AUDIENCE`: `mercadoya-services`.
- `AGENT_MODEL_PROVIDER`: `openai` por defecto, o `echo` para respuesta determinista.
- `AGENT_MODEL`: `gpt-6-luna` por defecto.
- `AGENT_REASONING_EFFORT`: `low` por defecto. Se pasa solo mediante `reasoning`.
- `OPENAI_API_KEY`: requerida para llamar OpenAI. No se fija un `max_tokens` bajo.
- `LANGSMITH_API_KEY`: requerida por la imagen en modo lite incluso con `echo`.
- `LANGSMITH_PROJECT`: `mercadoya-agent` por defecto.
- `LANGSMITH_TRACING`: `true` por defecto. Las trazas se activan por entorno.

Después de cambiar variables del entorno de Compose, recrea el contenedor:

```sh
docker compose --profile agent up -d --force-recreate --wait agent-service
```

Un `docker compose restart agent-service` conserva el entorno anterior del
contenedor. Cambiar el modelo o el esfuerzo no requiere modificar código ni imagen.

## Autenticación y aislamiento

`auth.py` replica `packages/jwt-verifier`: RS256, `kid` presente, claims requeridos
`sub`, `iss`, `aud`, `iat`, `exp`, sujeto no vacío, role `user` o `admin`, sin leeway
y antigüedad máxima de 300 segundos. Comprueba NumericDate sin coerción de strings,
así como `nbf` si está presente. PyJWKClient tiene caché de JWKS de 60 segundos,
timeout de 3 segundos y cooldown de 5 segundos. `cache_keys=True` añade la caché de
claves por `kid` del patrón validado en el spike. La consulta corre en
`asyncio.to_thread` para no bloquear el event loop.

Las credenciales inválidas lanzan `Auth.exceptions.HTTPException(401)`. Si falla
la conexión al JWKS, se lanza un `RuntimeError` con un mensaje fijo sin credenciales.
En `langgraph-api==0.16.0`, `CustomAuthBackend._authenticate_custom` propaga las
excepciones generales y el servidor responde 500. El smoke comprueba esa respuesta.
Una clave ya cacheada puede seguir verificándose mientras el JWKS está caído.

El resultado de auth es `{"identity": sub, "role": role, "token": jwt}`.
`@auth.on` sobrescribe `metadata.owner` con la identidad autenticada y devuelve
el filtro `{"owner": identity}`. Esto cubre creación, lectura, búsqueda, actualización
y runs. Ni un `owner` enviado por el cliente ni conocer el UUID de otro comprador
dan acceso a un hilo ajeno; la lectura directa responde 404.

El token se entrega por `config["configurable"]["langgraph_auth_user"]`.
El grafo base no necesita leerlo. Las futuras acciones con confirmación deben seguir
este orden **dentro del mismo nodo de confirmación**:

```python
# Patrón futuro, no está implementado en el grafo base.
decision = interrupt(payload)
user = config["configurable"]["langgraph_auth_user"]
token = user["token"]
# Usar el token del request que reanuda, solo para esa llamada autorizada.
```

Al reanudar, el nodo interrumpido vuelve a ejecutarse con el usuario del request
nuevo. Los nodos anteriores no vuelven a ejecutarse. Leer el token antes del
interrupt o en un nodo anterior puede usar una credencial vencida. Nunca guardarlo
en state, metadata, logs ni argumentos del modelo. La llamada al modelo recibe
callbacks para streaming y trazas, sin reenviar `configurable`.

## Persistencia

El servidor proporciona el checkpointer; el grafo compila sin uno propio.
`agent-db-init` ejecuta `infra/postgres/agent-db-init.sql` usando `psql` contra
la DB administrativa `postgres`. Crea el rol y la DB si faltan, y actualiza el
password del rol. Puede repetirse sobre un volumen existente. No usa scripts de
entrypoint ni ejecuta migraciones contra `mercadoya`.

Postgres 18 conserva el volumen del repo en `/var/lib/postgresql`. Redis tiene
su volumen `redis_data` y AOF. Un restart, o down/up sin `-v`, conserva los hilos.
Las migraciones del Agent Server crean estas tablas propias en `agent_server`:
`assistant`, `assistant_versions`, `checkpoint_blobs`, `checkpoint_delete_queue`,
`checkpoint_writes`, `checkpoints`, `cron`, `run`, `schema_migrations`, `store`,
`thread` y `thread_ttl`. `disable_store` deshabilita sus rutas, pero no evita que
el servidor cree la tabla `store`.

```sh
docker compose exec -T postgres psql -U mercadoya -d agent_server -c '\dt'
docker compose --profile agent run --rm agent-db-init
```

## Web

El chat se monta en `RootLayout` solo después de obtener una sesión. Mantiene el
look de la web y se puede cerrar con Escape. `useStream` 1.2.3 usa SSE, `assistantId:
'agent'` y un fetch con `credentials: 'include'`. El navegador no obtiene ni guarda
el JWT. `@langchain/core` 1.2.1 satisface el peer `^1.1.48` de los paquetes fijados.

La web en 5173 usa `API_BASE_URL`, configurado por `VITE_API_URL` y con default
`http://localhost:8000`, igual que catálogo, pedidos y auth. No usa el origen de
Vite para el API. El CORS global existente de Kong permite cookies desde 5173 y
5174 sin cambios. `messageText` renderiza solo strings y bloques `type: "text"`,
conserva saltos de línea y omite reasoning. El `threadId` se guarda en sessionStorage
por usuario. Nuevo hilo limpia esa referencia y conserva el hilo anterior en el servidor.
Un cambio de usuario desmonta el chat anterior.

El comentario junto al hook deja preparado `stream.interrupts` y
`stream.respond({ aprobado }, { interruptId })`. No hay UI de confirmación.

## Tests y smoke sin secretos

Desde este directorio:

```sh
uv sync --locked
uv run ruff check
uv run pytest
uv run python scripts/smoke.py
```

El smoke genera una clave RSA, sirve un JWKS local y arranca en segundo plano
`uv run --locked langgraph dev --config langgraph.ci.json --no-browser --no-reload
--port 2024`. Vacía OpenAI/LangSmith, retira otras claves heredadas y no lee el `.env`
del repo. Espera `/ok`, verifica 401 sin token, crea un hilo con JWT válido, ejecuta
un run eco, comprueba aislamiento, un JWKS caído y ausencia de JWT en state/logs.
Termina los procesos al acabar. `--port 2025` permite usar otro puerto.

`langgraph.ci.json` fija echo y desactiva tracing con variables no secretas.
`langgraph dev` guarda su estado local en `.langgraph_api/`, ignorado por Git;
no usa Postgres. El job `agent-smoke` ejecuta esos mismos comandos y no prueba la
imagen Docker. Desde la raíz, `pnpm --filter @mercadoya/web test` cubre el render de
mensajes.

## Documentación consultada y límites

Documentación consultada el 2026-10-12:
[standalone](https://docs.langchain.com/langsmith/deploy-standalone-server),
[changelog](https://docs.langchain.com/langsmith/agent-server-changelog),
[CLI y configuración](https://docs.langchain.com/langsmith/cli),
[dev](https://docs.langchain.com/langsmith/local-dev-testing),
[auth](https://docs.langchain.com/langsmith/custom-auth),
[owner](https://docs.langchain.com/langsmith/resource-auth),
[interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts),
[ChatOpenAI](https://docs.langchain.com/oss/python/integrations/chat/openai),
[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[razonamiento](https://developers.openai.com/api/docs/guides/latest-model),
[trazas](https://docs.langchain.com/langsmith/trace-with-langgraph),
[PyJWT](https://pyjwt.readthedocs.io/en/stable/usage.html#retrieve-rsa-signing-keys-from-a-jwks-endpoint),
[useStream](https://reference.langchain.com/javascript/langchain-react/getting-started),
[transportes](https://reference.langchain.com/javascript/langchain-react/transports) y
[migración v1](https://reference.langchain.com/javascript/langchain-react/migration).

La doc standalone enumera licencia para despliegues; su ejemplo Docker es para
desarrollo local. El spike validó el modo lite sin license key, con una
`LANGSMITH_API_KEY` válida y salida a internet al arrancar. Sin esa key o sin red,
la imagen termina con `License verification failed`. Producción requiere licencia.
No se presenta lite como alternativa de producción.

La versión mínima de servidor del protocolo v1 de `@langchain/react` no está
documentada. Se conserva 0.16.0, que el spike probó con cookie, SSE y prefijo Kong.
El enlace original de Kong declarativo devuelve 404; la referencia vigente es
[DB-less mode](https://developer.konghq.com/gateway/db-less-mode/).

El JWT dura cinco minutos. Kong vuelve a obtenerlo desde la cookie en cada request;
no se conserva una credencial entre turnos. Esta base no incorpora renovación propia,
acciones o memoria de largo plazo.

## Verificación de la integración

La validación local del 2026-10-12 pasó con la imagen fijada y Postgres 18:
health por Kong, 401 sin sesión, dos compradores con búsquedas y lecturas aisladas,
owner forzado, mensajes conservados tras restart y tras eliminar/recrear el
contenedor sin borrar volúmenes. Kong arrancó con el upstream ausente y mantuvo
identity disponible. Después de recrear el agente se reinició Kong para renovar
su resolución del upstream, tal como hace `demo:agent`.

En la web de 5173 se verificó la cookie y el streaming de `gpt-6-luna`, con texto
limpio y saltos de línea. Las trazas aparecieron en el proyecto configurado por
el entorno de Compose. También pasaron las verificaciones del monorepo, 27 pruebas
de federación en cada variante dev, preview y manifest, el smoke existente de identity/Kong sin claves de IA y las
regresiones de Polar con Postgres/NATS dedicados. Estos resultados son locales;
el job nuevo queda listo para la siguiente ejecución de GitHub Actions.
