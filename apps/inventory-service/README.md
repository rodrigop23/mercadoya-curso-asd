# Inventory service

Inventory corre como contenedor Node/Hono en `:3003`. Consume `orders.placed` de NATS, consulta y ajusta stock mediante el API de Catalog, registra la reserva en `inventory_reservations` y publica `inventory.reserved` o `inventory.rejected`. Orders recibe el resultado y cambia el estado del pedido; el bridge de Notifications invoca el handler Lambda.

## Imagen y arranque

Desde la raíz, configura `CATALOG_INTERNAL_TOKEN` en `.env`, aplica el esquema y construye la imagen:

```sh
pnpm install
pnpm demo:infra
pnpm dev
```

La imagen se construye con `apps/inventory-service/Dockerfile` desde el contexto de la raíz. Su segunda etapa contiene solo Node, el código compilado y dependencias de producción. Compose publica `3003`, conecta la base en `postgres:5432`, NATS en `nats:4222`, Catalog e Identity en `host.docker.internal:3001`. El mapeo `host-gateway` también permite esa dirección en Linux. El API y Orders continúan como procesos Node iniciados por `pnpm dev`.

Prueba el healthcheck directo con `curl http://localhost:3003/api/inventory/health` o mediante el proxy con `curl http://localhost:3001/api/inventory/health`. Docker consulta la primera ruta cada 10 segundos. El healthcheck indica que responde el proceso; no comprueba conectividad con Catalog. El API debe estar levantado antes de crear pedidos.

| Variable                 | Valor en Compose                   | Uso                                                                                                    |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PORT`                   | `3003`                             | Puerto HTTP interno. No lo fijes en el `.env` de la raíz porque también lo leen API y Orders.          |
| `DATABASE_URL`           | Host `postgres`                    | La misma instancia PostgreSQL, solo la tabla `inventory_reservations` para Inventory.                  |
| `EVENT_BUS`              | `nats`                             | Único transporte admitido.                                                                             |
| `NATS_URL`               | `nats://nats:4222`                 | Inventory falla al arrancar si NATS no conecta.                                                        |
| `CATALOG_URL`            | `http://host.docker.internal:3001` | Origen del API monolito. Para ejecución local sin Docker, usa `http://localhost:3001`.                 |
| `IDENTITY_URL`           | `http://host.docker.internal:3001` | Origen de `GET /api/me`. Para ejecución local sin Docker, usa `http://localhost:3001`.                 |
| `CATALOG_INTERNAL_TOKEN` | Leído del `.env` de la raíz        | Token compartido para las rutas `/api/internal/catalog/*`. API e Inventory deben tener el mismo valor. |
| `INVENTORY_SERVICE_URL`  | `http://localhost:3003` en el API  | Destino del proxy `/api/inventory`.                                                                    |

El API conserva la definición de la tabla en `apps/api/src/db/inventory-schema.ts` y sus migraciones en `apps/api/drizzle`. Inventory posee su copia del schema en `src/inventory/schema.ts`; no importa código ni tablas de Catalog. El token compartido solo protege el puente de clase. Para otro entorno, usa una clave aleatoria y limita el acceso de red a las rutas internas.

`GET /api/inventory/health` es público. `GET /api/inventory/reservations/:orderId` exige una sesión Better Auth: Inventory reenvía la cookie o `Authorization` a Identity y responde `401` si falta la sesión. Una sesión válida permite consultar una reserva por UUID, con `404` cuando aún no existe. Esta ruta de lectura de clase no comprueba que el usuario sea el comprador del pedido. El navegador accede mediante el gateway en `:3001`.

## Guion de clase

Ejecuta `docker compose ps inventory` para mostrar la imagen, el puerto y su estado. Ejecuta `docker compose logs -f inventory` durante un pedido para mostrar el consumo de `orders.placed` y la publicación del resultado. Compara con `apps/orders-service`, que arranca como proceso Node con `pnpm dev`. Ambos comparten NATS y PostgreSQL, pero Inventory tiene un runtime empaquetado y se comunica con Catalog por HTTP.
