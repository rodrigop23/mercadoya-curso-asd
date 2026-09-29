# MercadoYa

Monorepo de MercadoYa con pnpm workspaces y Turborepo. Incluye una app React con Vite y TanStack Router y una API Hono. V0 implementa productos naive; V1 separa Identity y Catalog por contrato; V2 agrega Media, Orders, Inventory, Notifications y procesamiento de pedidos por eventos.

## Demo V0 naive

La rama congelada para la clase es [`v0-naive`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v0-naive). Sigue el [checklist de walkthrough](docs/demo-v0.md) para levantar el demo, recorrerlo y mostrar el acoplamiento de esta versión.

## Demo V1 modular

La rama [`v1-modular`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v1-modular) conserva el refactor de Identity y Catalog con acoplamiento por contrato. Sigue el [checklist de walkthrough](docs/demo-v1.md) para levantar la versión modular y recorrer los mismos flujos.

## Demo V2 integración

La rama [`v2-integration`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v2-integration) combina el pipeline local de imágenes, módulos de dominio y pedidos con fan-out por NATS. Sigue el [guion y checklist de 50 minutos](docs/demo-v2.md) para preparar y recorrer la demo.

`docker-compose.yml` inicia Postgres y NATS. El apéndice [`apps/cloud-pipeline-demo`](apps/cloud-pipeline-demo/README.md) muestra un pipeline S3→Lambda→S3 aislado; no participa en el publish de MercadoYa ni requiere credenciales AWS para `pnpm dev`.

En `v3-services`, Orders corre como proceso Node, Inventory como contenedor y Notifications usa un handler AWS Lambda. Un bridge NATS invoca ese handler directamente durante la clase local o mediante Function URL en AWS. Consulta [la guía de Notifications](apps/notifications-lambda/README.md).

El [paquete de contratos `@mercadoya/contracts`](packages/contracts/README.md) contiene los eventos NATS v1 y los puertos de Inventory. El [OpenAPI de Inventory](apps/inventory-service/openapi.yaml) es el ejemplo de API HTTP de la clase.

## Arquitectura y decisiones

Material para el walkthrough:

- Demos: [V0 naive](docs/demo-v0.md) en la rama [`v0-naive`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v0-naive), [V1 modular](docs/demo-v1.md) en la rama [`v1-modular`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v1-modular) y [V2 integración](docs/demo-v2.md) en la rama [`v2-integration`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v2-integration).
- ADRs: [0001 — monolito primero](docs/adr/0001-usar-monolito-primero.md), [0002 — stack React, Hono y Postgres](docs/adr/0002-elegir-stack-react-hono-postgres.md), [0003 — Identity y Catalog por contrato](docs/adr/0003-modular-identity-catalog-por-contrato.md), [0004 — pipeline local de imágenes](docs/adr/0004-media-pipeline-pipes-filters.md), [0005 — módulos service-based](docs/adr/0005-service-based-api-layer-schemas.md), [0006 — pedidos por eventos con NATS](docs/adr/0006-nats-order-placed-event-driven.md) y [0007 — demo cloud S3 aislada](docs/adr/0007-cloud-pipeline-demo-s3-aislado.md).
- C4 en Mermaid para S4 / V2: [nivel 1, contexto](docs/diagrams/c4-1-context.md), [nivel 2, contenedores](docs/diagrams/c4-2-containers.md) y [nivel 3, componentes](docs/diagrams/c4-3-components.md).
- Secuencias Mermaid: [pipeline local de imágenes](docs/diagrams/seq-media-pipeline.md) y [fan-out de `orders.placed`](docs/diagrams/seq-order-placed-fanout.md).

## Requisitos

- Node.js `24.14.1` o superior. El scaffold se creó usando el Node ya instalado en el sistema: `v24.14.1`.
- pnpm `11.8.0`. Usa el pnpm del sistema (`/opt/homebrew/bin/pnpm`); el proyecto no instala ni cambia versiones del runtime o del package manager.

El campo `engines` documenta el mínimo de Node, `.node-version` fija la versión utilizada para este proyecto y `packageManager` documenta pnpm.

## Instalar

```sh
pnpm install
```

## Demo V3: API Gateway y servicios

El API en `http://localhost:3001` es el gateway/BFF de la sesión 5 y el único origen de API que usa el navegador. Identity, Catalog y Media viven en ese proceso. El gateway proxifica `/api/orders` a Orders (`:3002`), `/api/inventory` a Inventory (`:3003`) y `/api/notifications` al bridge (`:3004`). La web en `:5173` llama directamente a `:3001` con `credentials: 'include'`; el API permite ese origen mediante CORS con credenciales. No hay otro proceso gateway.

Para levantar la demo desde una copia nueva, configura `.env` a partir de `.env.example`, asigna claves aleatorias a `BETTER_AUTH_SECRET`, `CATALOG_INTERNAL_TOKEN`, `NOTIFICATIONS_INGEST_TOKEN` y `NOTIFICATIONS_INVOKE_TOKEN`, y ejecuta:

```sh
pnpm install
pnpm demo:infra
pnpm dev
```

`demo:infra` inicia Postgres y NATS, aplica el esquema con `db:push` y construye e inicia Inventory en Compose. `pnpm dev` inicia web, API, Orders y el bridge de Notifications como procesos Node. El API debe estar listo antes de crear pedidos. Inventory puede arrancar antes del API porque consulta Catalog e Identity al recibir solicitudes o eventos.

| Componente | Puerto | Comprobación |
| --- | --- | --- |
| Web | 5173 | `http://localhost:5173` |
| API Gateway | 3001 | `http://localhost:3001/api/identity/health` |
| Orders | 3002 | `http://localhost:3001/api/orders/health` |
| Inventory | 3003 | `http://localhost:3001/api/inventory/health` |
| Notifications bridge | 3004 | `http://localhost:3001/api/notifications/health` |
| Postgres | 5432 | `docker compose ps postgres` |
| NATS | 4222 | `http://localhost:8222` para monitoreo |

| Tipo | Mecanismo | Quién lo usa |
| --- | --- | --- |
| Usuario | Cookie de sesión Better Auth; Orders e Inventory la validan con `GET /api/me` | Browser vía gateway, Orders, ruta de reservas de Inventory y Catalog admin |
| Servicio a Catalog | `x-catalog-internal-token` y `CATALOG_INTERNAL_TOKEN` | Inventory hacia rutas internas del API |
| Lambda y bridge a API | `x-invoke-token` y `x-ingest-token`, con secretos distintos | Notifications |

La autenticación de usuario y los secretos entre servicios cumplen fines distintos. Esta demo no incluye service mesh ni JWT/JWKS entre microservicios. `GET /api/orders/:orderId` queda público para seguir el estado del pedido; la lectura de reservas de Inventory exige sesión, pero no verifica la propiedad del pedido.

Comprobación rápida sin sesión. Sustituye el UUID de ejemplo por uno real si quieres consultar una reserva existente:

```sh
curl -i -X POST http://localhost:3001/api/orders -H 'Content-Type: application/json' -d '{"productId":"00000000-0000-4000-8000-000000000000","quantity":1}'
curl -i http://localhost:3001/api/inventory/reservations/00000000-0000-4000-8000-000000000000
curl -i http://localhost:3001/api/orders/health
curl -i http://localhost:3001/api/inventory/health
curl -i http://localhost:3001/api/notifications/health
```

Las dos primeras solicitudes responden `401` y las tres rutas de health responden `200`. Para comprobar el camino con sesión, inicia sesión con el cookie jar de [autenticación local](#autenticación-local), crea un producto con stock y envía el pedido con `-b /tmp/mercadoya-cookies.txt`. El `POST` responde `202` con `buyerId`; Inventory consume `orders.placed`, reserva stock mediante el token interno de Catalog y publica el resultado. Consulta `GET /api/inventory/reservations/:orderId` con el mismo cookie jar y revisa `GET /api/events` para la entrada `notification.stub` del bridge.

## Base de datos local

La API usa Drizzle ORM con el driver `node-postgres` (`pg`). Copia la configuración de ejemplo, asigna valores aleatorios a `CATALOG_INTERNAL_TOKEN`, `NOTIFICATIONS_INGEST_TOKEN` y `NOTIFICATIONS_INVOKE_TOKEN`, inicia PostgreSQL y NATS, y aplica el esquema antes de iniciar Inventory:

```sh
cp .env.example .env
pnpm demo:infra
```

`BETTER_AUTH_SECRET` debe ser una clave aleatoria de al menos 32 caracteres. Puedes generarla con `openssl rand -base64 48` y guardarla en `.env`; `BETTER_AUTH_URL` apunta a `http://localhost:3001`. Configura `EVENT_BUS=nats` y `NATS_URL=nats://localhost:4222` para Orders y el bridge de Notifications. Ambos fallan al arrancar si no pueden conectar a NATS. La API ya no consume esos eventos.

`docker-compose.yml` conserva PostgreSQL en el volumen `postgres_data`. NATS expone el cliente en `4222` y el endpoint de monitoreo en `8222`. Inventory corre en un contenedor en `3003`; se conecta al API del host mediante `host.docker.internal:3001`. Para detener los contenedores ejecuta `docker compose down`; `docker compose down -v` también elimina los datos de PostgreSQL.

Los comandos de esquema disponibles son `pnpm --filter @mercadoya/api db:generate`, `db:migrate`, `db:push` y `db:studio`. Usa `db:generate` seguido de `db:migrate` para generar y aplicar migraciones SQL; `db:push` sincroniza el esquema directamente y está pensado para desarrollo local.

## Desarrollo

Con Inventory, PostgreSQL y NATS activos en Compose, inicia web, API, Orders y el bridge de Notifications en paralelo desde la raíz:

```sh
pnpm dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:3001>
- Orders: <http://localhost:3002>
- Inventory: <http://localhost:3001/api/inventory/health>
- Notifications bridge: <http://localhost:3001/api/notifications/health>

El API proxifica `/api/orders` a Orders, `/api/inventory` a Inventory y `/api/notifications` al bridge. `POST /api/events/ingest` recibe las notificaciones del handler con `x-ingest-token` y mantiene la timeline de la web. La configuración del contenedor está en [el README de Inventory](apps/inventory-service/README.md), la de pedidos en [el README de Orders](apps/orders-service/README.md) y la de Lambda en [el README de Notifications](apps/notifications-lambda/README.md).

También puedes iniciar una aplicación individualmente con `pnpm --filter @mercadoya/web dev`, `pnpm --filter @mercadoya/api dev` o `pnpm --filter @mercadoya/orders-service dev`.

## Autenticación local

La API ofrece registro e inicio de sesión por email y contraseña en `/api/auth/*`, y `GET /api/me` devuelve la sesión actual o `401` si no hay una. El frontend debe enviar solicitudes con `credentials: 'include'` para conservar la cookie. CORS permite `http://localhost:5173` con credenciales.

Después de iniciar PostgreSQL y aplicar el esquema, crea el administrador demo una vez:

```sh
pnpm dlx auth@latest create-admin --config apps/api/src/modules/identity/auth.ts --email admin@mercadoya.local --password 'MercadoYaLocalAdmin2026!' --name 'Admin MercadoYa' --role admin --yes
```

Credenciales demo locales: `admin@mercadoya.local` / `MercadoYaLocalAdmin2026!`.

Registro e inspección de sesión con `curl` y un cookie jar:

```sh
curl -i -c /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo","email":"demo@mercadoya.local","password":"MercadoYaDemo2026!"}' \
  http://localhost:3001/api/auth/sign-up/email

curl -i -b /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  http://localhost:3001/api/me
```

Login admin, consulta de sesión y logout con el mismo cookie jar:

```sh
curl -i -c /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mercadoya.local","password":"MercadoYaLocalAdmin2026!"}' \
  http://localhost:3001/api/auth/sign-in/email

curl -i -b /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  http://localhost:3001/api/me

curl -i -b /tmp/mercadoya-cookies.txt -c /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://localhost:3001/api/auth/sign-out
```

## Comandos

```sh
pnpm build      # Construye web y API
pnpm typecheck  # Revisa TypeScript en las aplicaciones
pnpm lint       # Ejecuta oxlint en los paquetes
pnpm format     # Aplica oxfmt en los paquetes y la configuración de raíz
```

## Estructura

```text
apps/
  api/             Hono + TypeScript + Drizzle ORM
  orders-service/  Proceso Hono para pedidos y consumo NATS
  inventory-service/ Contenedor Hono para reservas y consumo NATS
  notifications-lambda/ Handler Lambda, bridge NATS y stack CDK
  web/             React + Vite + TanStack Router + TypeScript
  cloud-pipeline-demo/ CDK + Lambda, demo aislada de S3
packages/
  contracts/       Eventos NATS v1 y puertos compartidos
  tsconfig/        Configuración compartida de TypeScript
```

La API parte del template `nodejs` de `create-hono`; la web parte del modo `router-only` de `@tanstack/cli` y conserva su estructura de rutas file-based en `apps/web/src/routes/`.

Turbo coordina `dev`, `build`, `lint`, `format` y `typecheck` a partir de los scripts de cada workspace. La web tiene una ruta inicial configurada con TanStack Router. Las tareas de desarrollo son persistentes y se ejecutan en paralelo.

## Toolchain del sistema

Se conservan las versiones instaladas en la máquina: Node `v24.14.1` y pnpm `11.8.0`. El campo `packageManager` está fijado a `pnpm@11.8.0`; no se requiere nvm, fnm, Volta ni Corepack para instalar otra versión.
