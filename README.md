# MercadoYa

Monorepo de MercadoYa con pnpm workspaces y Turborepo. Incluye una app React con Vite y TanStack Router y una API Hono. V0 implementa productos naive; V1 separa Identity y Catalog por contrato; V2 agrega Media, Orders, Inventory, Notifications y procesamiento de pedidos por eventos. S5 (`v3-services`) extrae Orders, Inventory y Notifications, y monta el catálogo admin como MF en iframe.

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

- Demos: [V0 naive](docs/demo-v0.md) en la rama [`v0-naive`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v0-naive), [V1 modular](docs/demo-v1.md) en la rama [`v1-modular`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v1-modular), [V2 integración](docs/demo-v2.md) en la rama [`v2-integration`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v2-integration) y [V3 servicios y saga](docs/demo-v3.md) en la rama [`v3-services`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v3-services).
- ADRs V0–V2: [0001 — monolito primero](docs/adr/0001-usar-monolito-primero.md), [0002 — stack React, Hono y Postgres](docs/adr/0002-elegir-stack-react-hono-postgres.md), [0003 — Identity y Catalog por contrato](docs/adr/0003-modular-identity-catalog-por-contrato.md), [0004 — pipeline local de imágenes](docs/adr/0004-media-pipeline-pipes-filters.md), [0005 — módulos service-based](docs/adr/0005-service-based-api-layer-schemas.md), [0006 — pedidos por eventos con NATS](docs/adr/0006-nats-order-placed-event-driven.md) y [0007 — demo cloud S3 aislada](docs/adr/0007-cloud-pipeline-demo-s3-aislado.md).
- ADRs S5: [0008 — versión HTTP y despliegue de Inventory](docs/adr/0008-versionado-inventory.md), [0009 — Orders como proceso](docs/adr/0009-orders-proceso-tradicional.md), [0010 — Inventory en contenedores](docs/adr/0010-inventory-contenedor.md), [0011 — Notifications Lambda y bridge](docs/adr/0011-notifications-lambda-bridge.md), [0012 — API gateway y auth](docs/adr/0012-api-gateway-auth.md), [0013 — contratos y OpenAPI Inventory](docs/adr/0013-contracts-openapi-inventory.md), [0014 — MF admin en iframe](docs/adr/0014-mf-catalog-iframe.md) y [0015 — saga por coreografía y compensación](docs/adr/0015-saga-coreografia-compensacion.md).
- C4 S5 en Mermaid: [contexto](docs/diagrams/c4-1-context.md), [contenedores](docs/diagrams/c4-2-containers-v3.md) y [componentes del API, Orders y Notifications](docs/diagrams/c4-3-components-v3.md).
- Secuencias S5: [saga de compra, compensación y email](docs/diagrams/seq-order-placed-fanout-v3.md) y [admin en MF catálogo](docs/diagrams/seq-admin-mf-catalog.md). Las [vistas V2](docs/diagrams/c4-2-containers.md) y [Archify](docs/diagrams/archify/README.md) se conservan como material histórico.

## Requisitos

- Node.js `24.14.1` o superior. El scaffold se creó usando el Node ya instalado en el sistema: `v24.14.1`.
- pnpm `11.8.0`. Usa el pnpm del sistema (`/opt/homebrew/bin/pnpm`); el proyecto no instala ni cambia versiones del runtime o del package manager.

El campo `engines` documenta el mínimo de Node, `.node-version` fija la versión utilizada para este proyecto y `packageManager` documenta pnpm.

## Instalar

```sh
pnpm install
```

## Demo V3: API Gateway y servicios

### Microfrontend de administración

El host React en `:5173` conserva autenticación, menú y guard de `/admin/products`. Esa ruta monta el CRUD de `apps/mf-catalog`, una app Vite independiente en `:5174`, mediante iframe. El remoto consume Catalog en el API existente `:3001` con cookie de sesión. [La guía del remoto](apps/mf-catalog/README.md) explica el arranque individual, los orígenes y el límite de aislamiento del iframe. Buyer + admin no son dos MF; la composición es host + pieza remota.

```text
Host web :5173 ── /admin/products ──► MF catálogo admin :5174
      │                                     │
      └──────── catálogo buyer /catalog     └──► API Catalog :3001
```

El API en `http://localhost:3001` es el gateway/BFF de la sesión 5 y el único origen de API que usa el navegador. Identity, Catalog y Media viven en ese proceso. El gateway proxifica `/api/orders` a Orders (`:3002`), `/api/inventory/v1` a Inventory v1 (`:3003`), `/api/inventory/v2` a Inventory v2 (`:3005`) y `/api/notifications` al bridge (`:3004`). Las rutas de Inventory sin versión siguen como alias v1. La web en `:5173` y el MF en `:5174` llaman directamente a `:3001` con `credentials: 'include'`; el API permite ambos orígenes mediante CORS con credenciales. Kong queda fuera del laboratorio y de Compose.

Para levantar la demo desde una copia nueva, configura `.env` a partir de `.env.example`, asigna claves aleatorias a `BETTER_AUTH_SECRET`, `CATALOG_INTERNAL_TOKEN`, `NOTIFICATIONS_INGEST_TOKEN` y `NOTIFICATIONS_INVOKE_TOKEN`, y ejecuta:

```sh
pnpm install
pnpm demo:infra
pnpm dev
```

`demo:infra` inicia Postgres y NATS, aplica el esquema con `db:push` y construye e inicia `inventory-v1` e `inventory-v2` en Compose. `pnpm dev` inicia web, MF catálogo admin, API, Orders y el bridge de Notifications. El API debe estar listo antes de crear pedidos. Inventory puede arrancar antes del API porque consulta Catalog e Identity al recibir solicitudes o eventos.

| Componente           | Puerto | Comprobación                                     |
| -------------------- | ------ | ------------------------------------------------ |
| Web                  | 5173   | `http://localhost:5173`                          |
| MF catálogo admin    | 5174   | `http://localhost:5174`                          |
| API Gateway          | 3001   | `http://localhost:3001/api/identity/health`      |
| Orders               | 3002   | `http://localhost:3001/api/orders/health`        |
| Inventory v1         | 3003   | `http://localhost:3001/api/inventory/v1/health`  |
| Inventory v2         | 3005   | `http://localhost:3001/api/inventory/v2/health`  |
| Notifications bridge | 3004   | `http://localhost:3001/api/notifications/health` |
| Postgres             | 5432   | `docker compose ps postgres`                     |
| NATS                 | 4222   | `http://localhost:8222` para monitoreo           |

| Tipo                  | Mecanismo                                                                     | Quién lo usa                                                               |
| --------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Usuario               | Cookie de sesión Better Auth; Orders e Inventory la validan con `GET /api/me` | Browser vía gateway, Orders, ruta de reservas de Inventory y Catalog admin |
| Servicio a Catalog    | `x-catalog-internal-token` y `CATALOG_INTERNAL_TOKEN`                         | Inventory hacia rutas internas del API                                     |
| Lambda y bridge a API | `x-invoke-token` y `x-ingest-token`, con secretos distintos                   | Notifications                                                              |

La autenticación de usuario y los secretos entre servicios cumplen fines distintos. Esta demo no incluye service mesh ni JWT/JWKS entre microservicios. `GET /api/orders/:orderId` queda público para seguir el estado del pedido; la lectura de reservas de Inventory exige sesión, pero no verifica la propiedad del pedido.

| Versión  | Cambio observable                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API HTTP | `/api/inventory/v1/reservations/:orderId` conserva el JSON anterior; `/v2/` exige además `reservation.status: "reserved"`.                                                                                                               |
| Servicio | Compose ejecuta `inventory-v1` e `inventory-v2` con `SERVICE_VERSION` distinto. Cada respuesta lleva `X-Service-Version`. Solo v1 consume `orders.placed` y `payment.failed`, para reservar y compensar sin duplicar consumidores en v2. |

Consulta el [guion de Inventory](apps/inventory-service/README.md) para comparar ambas respuestas con el mismo pedido y la misma cookie. La decisión está resumida en el [ADR 0008](docs/adr/0008-versionado-inventory.md).

Comprobación rápida sin sesión. Sustituye el UUID de ejemplo por uno real si quieres consultar una reserva existente:

```sh
curl -i -X POST http://localhost:3001/api/orders -H 'Content-Type: application/json' -d '{"productId":"00000000-0000-4000-8000-000000000000","quantity":1}'
curl -i http://localhost:3001/api/inventory/reservations/00000000-0000-4000-8000-000000000000
curl -i http://localhost:3001/api/orders/health
curl -i http://localhost:3001/api/inventory/health
curl -i http://localhost:3001/api/inventory/v1/health
curl -i http://localhost:3001/api/inventory/v2/health
curl -i http://localhost:3001/api/notifications/health
```

Las dos primeras solicitudes responden `401` y las rutas de health responden `200`. Para comprobar el camino con sesión, inicia sesión con el cookie jar de [autenticación local](#autenticación-local), crea un producto con stock y envía el pedido con `-b /tmp/mercadoya-cookies.txt`. El `POST` responde `202` con `buyerId`; Inventory v1 consume `orders.placed`, reserva stock mediante el token interno de Catalog y publica el resultado. Consulta las rutas `/api/inventory/v1/reservations/:orderId` y `/api/inventory/v2/reservations/:orderId` con el mismo cookie jar y revisa `GET /api/events` para la entrada `notification.stub` o `notification.email` del handler y su `emailStatus`. La reserva dispara el simulador; el pedido se confirma solo con `payment.succeeded`.

### Saga, compensación y correos

Orders `:3002` aloja el simulador de pago. `inventory.reserved` inicia el pago simulado y `payment.succeeded` confirma el pedido. `inventory.rejected` rechaza sin pago. `payment.failed` rechaza el pedido y dispara la liberación en Inventory v1, que restaura stock y publica `inventory.released`. El rechazo y el correo de pago fallido pueden aparecer antes de completar la liberación. Consulta [ADR 0015](docs/adr/0015-saga-coreografia-compensacion.md) y [la secuencia canónica](docs/diagrams/seq-order-placed-fanout-v3.md).

Con la demo activa y un producto dedicado con al menos dos unidades, ejecuta:

```sh
pnpm demo:saga
```

[La guía del CLI](scripts/README.md) explica los tres casos y la prueba de fallos duplicados. El CLI crea pedidos persistentes y consume una unidad en el caso exitoso. `PAYMENT_MODE=succeed` es el valor por defecto; `fail` fuerza fallos tras reiniciar Orders. El override `paymentMode` del CLI tiene prioridad y no forma parte del POST público.

Notifications escucha solo estos desenlaces y renderiza los templates con React Email:

| Subject              | Template                     | Correo                         |
| -------------------- | ---------------------------- | ------------------------------ |
| `payment.succeeded`  | `order-confirmed.tsx`        | Pedido confirmado              |
| `inventory.rejected` | `order-rejected-stock.tsx`   | No pudimos completar tu pedido |
| `payment.failed`     | `order-rejected-payment.tsx` | El pago no se completó         |

Para enviar correo configura `RESEND_API_KEY`, `RESEND_FROM`, `DEMO_NOTIFY_EMAIL` y `EMAIL_MODE=resend`, y reinicia el bridge local. Si usas Lambda, configura sus variables mediante el despliegue. Todos los pedidos usan `DEMO_NOTIFY_EMAIL`, sin lookup en Identity por `buyerId`. `EMAIL_MODE` vacío elige Resend si hay key y stub si no la hay; `EMAIL_MODE=stub` fuerza simulación. Consulta [la guía de Resend y Notifications](apps/notifications-lambda/README.md) para los requisitos del remitente y los casos de configuración incompleta.

La timeline registra `notification.stub` o `notification.email`, con `emailStatus` igual a `stub`, `sent` o `error`. `sent` significa aceptación por Resend. El envío no revierte la saga si falla; NATS Core no reproduce eventos y la timeline se pierde al reiniciar el API.

## Base de datos local

La API usa Drizzle ORM con el driver `node-postgres` (`pg`). Copia la configuración de ejemplo, asigna valores aleatorios a `CATALOG_INTERNAL_TOKEN`, `NOTIFICATIONS_INGEST_TOKEN` y `NOTIFICATIONS_INVOKE_TOKEN`, inicia PostgreSQL y NATS, y aplica el esquema antes de iniciar Inventory:

```sh
cp .env.example .env
pnpm demo:infra
```

`BETTER_AUTH_SECRET` debe ser una clave aleatoria de al menos 32 caracteres. Puedes generarla con `openssl rand -base64 48` y guardarla en `.env`; `BETTER_AUTH_URL` apunta a `http://localhost:3001`. Configura `EVENT_BUS=nats` y `NATS_URL=nats://localhost:4222` para Orders y el bridge de Notifications. Ambos fallan al arrancar si no pueden conectar a NATS. La API ya no consume esos eventos.

`docker-compose.yml` conserva PostgreSQL en el volumen `postgres_data`. NATS expone el cliente en `4222` y el endpoint de monitoreo en `8222`. Inventory corre en dos contenedores en `3003` y `3005`; se conectan al API del host mediante `host.docker.internal:3001`. Para detener los contenedores ejecuta `docker compose down`; `docker compose down -v` también elimina los datos de PostgreSQL.

Los comandos de esquema disponibles son `pnpm --filter @mercadoya/api db:generate`, `db:migrate`, `db:push` y `db:studio`. Usa `db:generate` seguido de `db:migrate` para generar y aplicar migraciones SQL; `db:push` sincroniza el esquema directamente y está pensado para desarrollo local.

## Desarrollo

Con Inventory, PostgreSQL y NATS activos en Compose, inicia web, MF catálogo admin, API, Orders y el bridge de Notifications en paralelo desde la raíz:

```sh
pnpm dev
```

- Web: <http://localhost:5173>
- MF catálogo admin: <http://localhost:5174>
- API: <http://localhost:3001>
- Orders: <http://localhost:3002>
- Inventory v1: <http://localhost:3001/api/inventory/v1/health>
- Inventory v2: <http://localhost:3001/api/inventory/v2/health>
- Notifications bridge: <http://localhost:3001/api/notifications/health>

El API proxifica `/api/orders` a Orders, `/api/inventory/v1` y `/api/inventory/v2` a sus despliegues y `/api/notifications` al bridge. `POST /api/events/ingest` recibe las notificaciones del handler con `x-ingest-token` y mantiene la timeline de la web. La configuración de los contenedores está en [el README de Inventory](apps/inventory-service/README.md), la de pedidos en [el README de Orders](apps/orders-service/README.md) y la de Lambda en [el README de Notifications](apps/notifications-lambda/README.md).

También puedes iniciar una aplicación individualmente con `pnpm --filter @mercadoya/web dev`, `pnpm --filter @mercadoya/mf-catalog dev`, `pnpm --filter @mercadoya/api dev` o `pnpm --filter @mercadoya/orders-service dev`.

## Autenticación local

La API ofrece registro e inicio de sesión por email y contraseña en `/api/auth/*`, y `GET /api/me` devuelve la sesión actual o `401` si no hay una. El frontend debe enviar solicitudes con `credentials: 'include'` para conservar la cookie. CORS permite `http://localhost:5173` y `http://localhost:5174` con credenciales.

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
  inventory-service/ Dos despliegues Hono para lectura de reservas; v1 consume NATS
  notifications-lambda/ Handler Lambda, bridge NATS y stack CDK
  mf-catalog/      MF de productos admin en iframe, Vite :5174
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

## Saga de compra por coreografía

En `v3-services`, Inventory reserva stock al recibir `orders.placed`. El pedido sigue `pending` tras `inventory.reserved`; un simulador didáctico dentro de Orders publica `payment.succeeded` para confirmarlo o `payment.failed` para rechazarlo. El fallo activa la compensación en Inventory v1, que restaura stock y publica `inventory.released`. El rechazo por stock no inicia Payment ni libera reservas. No hay orquestador ni PSP real.

Ejecuta `pnpm demo:saga` para comprobar los tres caminos y fallos duplicados. Los requisitos y efectos sobre los datos están en el [README del CLI](scripts/README.md). Notifications envía con Resend y React Email un correo por desenlace: confirmación, rechazo por stock o fallo de pago. También admite modo stub. Sigue el [checklist V3](docs/demo-v3.md) para preparar la clase y consultar los ADRs y diagramas de saga y correo.
