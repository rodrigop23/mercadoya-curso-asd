# Rendimiento a través de Kong

Desde la raíz, con Docker, Node 24.14.1, pnpm 11.8.0 y las dependencias instaladas:

```sh
pnpm perf:local
pnpm perf:ci
bash scripts/perf.sh local down
```

`perf:local` prepara la stack `mercadoya-perf`, migra su PostgreSQL, inserta 1000
productos sintéticos, construye los contenedores y espera su salud con `--wait`.
Kong escucha en `127.0.0.1:18000` y PostgreSQL en `127.0.0.1:15432`. Los datos y
volúmenes pertenecen a esa stack. La demo habitual puede seguir usando el puerto 8000. `down` elimina solo los contenedores y volúmenes de rendimiento.

Si k6 no está instalado, `scripts/k6.sh` descarga v2.3.0 de GitHub, comprueba su
SHA256 contra los checksums de la release y lo conserva en la cache del usuario.
No cambia Node, pnpm ni uv. En CI, setup-k6 instala esa versión y se ejecuta
`k6 run` directamente. `--no-usage-report` desactiva la telemetría de k6.

El perfil local dura dos minutos por escenario, concurrentes. Cada escenario
rampa de 0 a 20 VUs en 30 segundos, mantiene 20 durante 60 segundos y baja a 0
en 30 segundos. Son hasta 40 VUs en total, más un VU para cinco requests sin JWT.
El perfil CI tiene cinco VUs por escenario durante 30 segundos. Cada iteración
espera 200 ms antes de repetir. Los umbrales son iguales en ambos perfiles.

La búsqueda rota diez términos y usa los filtros reales `q`, `minPrice` y
`maxPrice`. El agente crea un hilo, llama a `threads/{id}/runs/wait`, verifica la
respuesta echo y elimina el hilo. La latencia `agent_chat` mide solo `runs/wait`;
creación y borrado tienen tags separados y cuentan en errores y checks.

`setup()` crea un comprador sintético con `POST /api/auth/sign-up/email`, inicia
sesión con `POST /api/auth/sign-in/email` y obtiene el JWT con
`GET /api/auth/token`, mediante la cookie de sesión. No requiere un comprador
preexistente ni credenciales humanas. Las cinco llamadas sin JWT esperan 401 y
usan `responseCallback: http.expectedStatuses(401)` solo en ese request.

El override fuerza `echo`, `rules`, moderación apagada y tracing apagado. Vacía
las credenciales de OpenAI, Cloudflare y LangSmith. El runner comprueba los
valores dentro del contenedor e imprime únicamente el proveedor y si la clave
está vacía. Polar tiene un valor inválido de fixture; la semilla SQL no crea
trabajos de sincronización y la carga no invoca pagos ni mutaciones.

La imagen de `langgraph build` requiere licencia o una clave LangSmith incluso
con echo. Este override usa `langgraph dev`, API 0.16.0, CLI 0.4.33 y locks
existentes, sin claves. Sus checkpoints son en memoria. Esta medición no incluye
el runtime PostgreSQL licenciado. Redis y `agent-db-init` siguen en el perfil
Compose, pero el agente dev no los usa. La demo habitual conserva su imagen.

Para repetir la carga sobre la stack ya lista:

```sh
bash scripts/perf.sh local k6
```

El script rechaza destinos ajenos a `localhost` y `127.0.0.1` antes de enviar
requests. `BASE_URL` permite elegir otro puerto local. `K6_ALLOW_REMOTE=1`
habilita explícitamente un destino remoto; los comandos habituales no lo usan.

Para demostrar que el umbral detecta una regresión, con la stack lista:

```sh
node tests/perf/negative.mjs
```

El test agrega temporalmente `ngx.sleep(2)` en Kong, solo para `runs/wait`.
Ejecuta el perfil CI y exige exit 99 y `✗` en el umbral del agente. Después
restaura Kong en `finally` y elimina los overrides temporales. No ejecutar
simultáneamente con mediciones base. El comando del test sale con 0 si demuestra
el fallo esperado; el proceso k6 que ejecuta sale con 99.

`tests/perf/out/summary.json` contiene exclusivamente métricas, sin headers,
bodies, JWT, URLs con identificadores ni datos personales. La carpeta `out`
está ignorada por Git. `stack.env`, con credenciales efímeras locales y permisos
0600, queda allí hasta `down`; nunca se sube como artifact. CI sube únicamente
`summary.json` y siempre ejecuta `down -v`.

Consulta [las funciones, mediciones y respuesta a fallos](../../docs/architecture/fitness-functions.md)
y [la ADR 0031](../../docs/adr/0031-fitness-functions.md).
