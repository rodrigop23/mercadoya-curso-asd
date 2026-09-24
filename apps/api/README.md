# MercadoYa API

API Hono para Node.js con acceso a PostgreSQL mediante Drizzle ORM y el driver `node-postgres` (`pg`).

Desde la raíz del monorepo, ejecuta `pnpm --filter @mercadoya/api dev`. La API responde en <http://localhost:3001>.

## Base de datos local

Desde la raíz del monorepo, copia `.env.example` a `.env` y levanta PostgreSQL con `docker compose up -d`. La variable `DATABASE_URL` configura tanto el cliente de la API como drizzle-kit.

Aplica el esquema de Drizzle con:

```sh
pnpm --filter @mercadoya/api db:push
```

Para generar migraciones versionadas usa `pnpm --filter @mercadoya/api db:generate` y después `pnpm --filter @mercadoya/api db:migrate`. El cliente y el esquema extensible están en `src/db/`.

## Pedidos y reservas de stock

Orders crea un pedido en estado `pending`, solicita la reserva a Inventory y lo deja en `confirmed` o `rejected`. Inventory registra solo las reservas aceptadas y descuenta stock mediante el contrato de Catalog. Un pedido rechazado devuelve `409` e incluye `order` y `reason`. Si hay una sesión activa, `buyerId` se toma de ella; de lo contrario queda en `null`.

Después de actualizar el código, sincroniza el esquema local con `pnpm --filter @mercadoya/api db:push`. Para preparar la demo, inicia sesión en <http://localhost:5173/admin/products> y crea un producto con stock `5` y otro con stock `0`; usa los UUID de `GET /api/products` en los ejemplos:

```sh
curl -i -X POST http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"productId":"REEMPLAZAR_POR_UUID_CON_STOCK","quantity":1}'

curl -i -X POST http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"productId":"REEMPLAZAR_POR_UUID_CON_STOCK_CERO","quantity":1}'
```

La primera petición responde `201`, crea un pedido confirmado, registra una fila en `inventory_reservations` y descuenta una unidad de `product.stock`. La segunda responde `409` con el pedido rechazado y la razón `insufficient_stock`.
