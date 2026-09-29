# Orders service

Proceso Node/Hono para crear y consultar pedidos. Escucha en `http://localhost:3002` y conserva el ciclo `pending` → `confirmed` o `rejected`. Publica `orders.placed` y consume `inventory.reserved` e `inventory.rejected` por NATS.

Usa el mismo `DATABASE_URL` PostgreSQL que `@mercadoya/api` y la tabla existente `orders_order`. Por ahora, las migraciones de esa tabla siguen en `apps/api/drizzle`; `pnpm --filter @mercadoya/api db:push` aplica el esquema. La separación de bases queda para una fase posterior.

Variables en el `.env` de la raíz:

| Variable | Valor local | Uso |
| --- | --- | --- |
| `PORT` | `3002` por defecto | Puerto del servicio. Si arrancas todo con `pnpm dev`, deja la variable sin definir para no cambiar el puerto del API. |
| `DATABASE_URL` | URL de PostgreSQL de Compose | Base compartida con el API. |
| `EVENT_BUS` | `nats` | Es el único transporte admitido por Orders. |
| `NATS_URL` | `nats://localhost:4222` | Servidor NATS. Orders falla al arrancar si no conecta. |
| `IDENTITY_URL` | `http://localhost:3001` | Origen del API para consultar `GET /api/me`. |
| `ORDERS_SERVICE_URL` | `http://localhost:3002` | Destino del proxy del API; se configura en el API. |

`pnpm dev` inicia web, API y Orders. Para iniciar solo este proceso, usa `pnpm --filter @mercadoya/orders-service dev`. El navegador sigue llamando `:3001/api/orders`; el API reenvía método, ruta, query, cabeceras y cuerpo. Orders reenvía la cookie o `Authorization` a `:3001/api/me` y usa `user.id` como `buyerId`. Una sesión ausente conserva el comportamiento de pedido invitado; un fallo de Identity devuelve error al crear el pedido.
