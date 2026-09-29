# MercadoYa API

API Hono para Node.js con acceso a PostgreSQL mediante Drizzle ORM y el driver `node-postgres` (`pg`).

Desde la raíz del monorepo, ejecuta `pnpm --filter @mercadoya/api dev`. La API responde en <http://localhost:3001>.

## Base de datos local

Desde la raíz del monorepo, copia `.env.example` a `.env` y levanta PostgreSQL y NATS con `docker compose up -d`. La variable `DATABASE_URL` configura tanto el cliente de la API como drizzle-kit. La API conecta a NATS con `NATS_URL=nats://localhost:4222`; define `EVENT_BUS=inprocess` para usar el transporte local o si NATS no está disponible al arrancar.

Aplica el esquema de Drizzle con:

```sh
pnpm --filter @mercadoya/api db:push
```

Para generar migraciones versionadas usa `pnpm --filter @mercadoya/api db:generate` y después `pnpm --filter @mercadoya/api db:migrate`. El cliente y el esquema extensible están en `src/db/`.

## Pedidos y reservas de stock

Orders guarda cada pedido como `pending` y publica `orders.placed` con un payload versionado y validado con Zod. Inventory consume el evento y reserva stock con la misma lógica y el contrato de Catalog; luego publica `inventory.reserved` o `inventory.rejected`. Orders actualiza el estado a `confirmed` o `rejected` cuando recibe ese resultado. El `POST /api/orders` responde `202` con el pedido pendiente; consulta `GET /api/orders/:orderId` para ver su estado eventual. Si hay una sesión activa, `buyerId` se toma de ella; de lo contrario queda en `null`.

Notifications consume `orders.placed` y el resultado de Inventory con un sender stub que escribe `notification.stub` en la consola. Los logs JSON de la API incluyen `event.publish`, `event.consume`, `inventory.reservation` y `orders.status_updated` para mostrar el fan-out: un publish de Orders llega a Inventory y Notifications. Los subjects disponibles son `orders.placed`, `inventory.reserved` e `inventory.rejected`.

Después de actualizar el código, sincroniza el esquema local con `pnpm --filter @mercadoya/api db:push`. Para preparar la demo, inicia sesión en <http://localhost:5173/admin/products> y crea un producto con stock `5` y otro con stock `0`; usa los UUID de `GET /api/products` en los ejemplos:

```sh
curl -i -X POST http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"productId":"REEMPLAZAR_POR_UUID_CON_STOCK","quantity":1}'

curl -i -X POST http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"productId":"REEMPLAZAR_POR_UUID_CON_STOCK_CERO","quantity":1}'
```

Ambas peticiones responden `202` con un pedido `pending`. La primera registra una fila en `inventory_reservations`, descuenta una unidad de `product.stock` y termina en `confirmed`. La segunda termina en `rejected` con la razón `insufficient_stock`. Consulta el estado con `curl http://localhost:3001/api/orders/UUID_DEL_PEDIDO` después de revisar los logs del fan-out.
