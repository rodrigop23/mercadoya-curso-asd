# Inventory como contenedor

Inventory corre en un único contenedor Node/Hono, `inventory`, en `:3003`. Consume `orders.placed` para reservar stock mediante Catalog y `payment.failed` para compensar. Guarda las reservas en `inventory_reservations` y publica `inventory.reserved`, `inventory.rejected` o `inventory.released`. Los subjects y los eventos con `version: 1` se conservan.

El contrato HTTP vigente exige `reservation.status: "reserved"`. Kong publica solo `/api/inventory/health` y `/api/inventory/reservations/:orderId`. La comparación de dos despliegues y contratos queda en la rama `v3-services`.

Consulta [Swagger UI](http://localhost:3003/docs) y el [OpenAPI generado](http://localhost:3003/openapi.yaml). El proceso sirve el archivo canónico de Git sin transformarlo. Swagger carga recursos de un CDN y requiere internet. Para regenerarlo desde Zod y metadatos, ejecuta `pnpm openapi:generate`; `pnpm openapi:check` comprueba reproducción y lint.

## Despliegue local

Desde la raíz, prepara `.env` a partir de `.env.example` y ejecuta `pnpm demo:infra`. El Dockerfile usa Node, código compilado y dependencias de producción. Compose conecta Inventory con PostgreSQL, NATS, Catalog e Identity.

```sh
docker compose ps inventory
curl -i http://localhost:8000/api/inventory/health
curl -i -b /tmp/mercadoya-cookies.txt "http://localhost:8000/api/inventory/reservations/$ORDER_ID"
docker compose logs -f inventory
```

Health es público y devuelve `{"module":"inventory","ok":true}`. Docker consulta ese endpoint cada 10 segundos. Comprueba que el proceso responde; no comprueba Catalog. La lectura exige autenticación. Kong admite cookie de sesión o Bearer y reenvía JWT; Inventory verifica RS256, kid, issuer, audience y claims mediante JWKS. El acceso directo requiere Bearer. Se conserva el acceso de lectura de clase sin verificar ownership de la reserva.

## Variables

| Variable                 | Valor local o Compose         | Uso                                |
| ------------------------ | ----------------------------- | ---------------------------------- |
| `PORT`                   | `3003`                        | Puerto HTTP.                       |
| `DATABASE_URL`           | PostgreSQL en `postgres:5432` | Persistencia de reservas.          |
| `EVENT_BUS`              | `nats`                        | Único transporte admitido.         |
| `NATS_URL`               | `nats://nats:4222`            | Eventos de saga.                   |
| `CATALOG_URL`            | `http://catalog:3007`         | Stock por HTTP interno.            |
| `CATALOG_INTERNAL_TOKEN` | Secreto de `.env`             | Autenticación interna con Catalog. |
| `IDENTITY_URL`           | `http://identity:3006`        | JWKS de Identity.                  |
| `JWT_ISSUER`             | `http://localhost:8000`       | Emisor esperado.                   |
| `JWT_AUDIENCE`           | `mercadoya-services`          | Audiencia esperada.                |

## Saga y pruebas

Inventory registra un handler por subject de entrada. La reserva y la liberación conservan el lock por pedido. Una liberación duplicada no restaura stock ni publica otra liberación cuando ya no existe reserva. NATS Core no retiene eventos ni garantiza reintentos duraderos.

`pnpm --filter @mercadoya/inventory-service test` comprueba rutas, autenticación, DTO y registro de suscripciones. La integración de Orders prueba reserva, rechazo, compensación y duplicados con PostgreSQL y NATS dedicados, sin credenciales Polar. Consulta [Orders](../orders-service/README.md) y [ADR 0015](../../docs/adr/0015-saga-coreografia-compensacion.md).

Para actualizar una instalación anterior, pausa la creación de pedidos, detén los contenedores Inventory anteriores y ejecuta `docker compose up -d --build --remove-orphans`. Comprueba un único Inventory healthy y una sola conexión NATS `mercadoya-inventory` antes de reanudar. Los eventos enviados durante la pausa no se reproducen.
