# Inventory service

Inventory corre en dos contenedores Node/Hono: `inventory-v1` en `:3003` e `inventory-v2` en `:3005`. Solo `inventory-v2` consume `orders.placed` de NATS, consulta y ajusta stock mediante el API de Catalog, registra la reserva en `inventory_reservations` y publica `inventory.reserved` o `inventory.rejected`. Los dos contenedores leen la misma tabla de reservas. Así un pedido se procesa una sola vez mientras ambas API responden en paralelo.

El [OpenAPI de Inventory](openapi.yaml) documenta `health` y la lectura de reservas por HTTP. Los eventos NATS v1 y los puertos `InventoryPort` y `CatalogStockContract` viven en [@mercadoya/contracts](../../packages/contracts/README.md). La reserva entra por `orders.placed`, no por una ruta HTTP.

Explora el contrato por defecto en [Swagger UI v2](http://localhost:3005/docs). [Swagger UI v1](http://localhost:3003/docs) queda disponible para comparar compatibilidad. Ambos procesos sirven el archivo de git sin transformarlo en [`/openapi.yaml`](http://localhost:3005/openapi.yaml). La UI carga sus recursos desde un CDN y requiere conexión a internet.

## Imagen y arranque

Desde la raíz, configura `CATALOG_INTERNAL_TOKEN` en `.env`, aplica el esquema y construye la imagen:

```sh
pnpm install
pnpm demo:infra
pnpm dev
```

La imagen se construye con `apps/inventory-service/Dockerfile` desde el contexto de la raíz. Su segunda etapa contiene Node, el código compilado, dependencias de producción y el `openapi.yaml` canónico. Compose crea dos servicios con la misma imagen y `SERVICE_VERSION=v1|v2`; publica `3003` y `3005`, conecta la base en `postgres:5432`, NATS en `nats:4222`, Catalog en `http://api:3001` e Identity en `http://identity:3006`. API y Orders también corren en Compose.

Prueba los healthchecks mediante el gateway con `curl -i http://localhost:8000/api/inventory/v1/health` y `curl -i http://localhost:8000/api/inventory/v2/health`. Ambos responden con `serviceVersion` y `X-Service-Version` distintos. Docker consulta el healthcheck de cada contenedor cada 10 segundos. Indica que responde el proceso; no comprueba conectividad con Catalog. El API debe estar levantado antes de crear pedidos.

| Variable                 | Valor en Compose                   | Uso                                                                                                    |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PORT`                   | `3003`                             | Puerto HTTP interno. No lo fijes en el `.env` de la raíz porque también lo leen API y Orders.          |
| `SERVICE_VERSION`        | `v1` o `v2`                       | Decide las rutas HTTP y el valor de `X-Service-Version`. Solo v2 consume `orders.placed` y `payment.failed`; es el default si falta la variable.              |
| `DATABASE_URL`           | Host `postgres`                    | La misma instancia PostgreSQL, solo la tabla `inventory_reservations` para Inventory.                  |
| `EVENT_BUS`              | `nats`                             | Único transporte admitido.                                                                             |
| `NATS_URL`               | `nats://nats:4222`                 | Inventory falla al arrancar si NATS no conecta.                                                        |
| `CATALOG_URL`            | `http://api:3001` | Origen del API con Catalog. Para ejecución local sin Docker, usa `http://localhost:3001`.                 |
| `IDENTITY_URL`           | `http://identity:3006` | JWKS de Identity. Para ejecución local sin Docker, usa `http://localhost:3006`.                 |
| `CATALOG_INTERNAL_TOKEN` | Leído del `.env` de la raíz        | Token compartido para las rutas `/api/internal/catalog/*`. API e Inventory deben tener el mismo valor. |
| `INVENTORY_V1_URL`       | `http://localhost:3003` en el API | Solo compatibilidad explícita en `/api/inventory/v1/*`.                                               |
| `INVENTORY_V2_URL`       | `http://localhost:3005` en el API | Destino por defecto de `/api/inventory/v2/*` y del alias sin versión.                                                                       |

El API conserva la definición de la tabla en `apps/api/src/db/inventory-schema.ts` y sus migraciones en `apps/api/drizzle`. Inventory posee su copia del schema en `src/inventory/schema.ts`; no importa código ni tablas de Catalog. El token compartido solo protege el puente de clase. Para otro entorno, usa una clave aleatoria y limita el acceso de red a las rutas internas.

Health es público. Las reservas requieren autenticación. Kong `:8000` acepta la sesión browser o Bearer y reenvía JWT. Inventory verifica RS256, kid, issuer/audience y claims mediante JWKS, sin consultar `/api/me` ni reenviar cookies. El acceso directo requiere Bearer JWT. `IDENTITY_URL=http://identity:3006` en Compose; issuer es `http://localhost:8000` y audience `mercadoya-services`. Una credencial inválida produce 401. Se mantiene el acceso de lectura de clase sin comprobar ownership de la reserva. El alias sin versión usa v2; v1 es explícito y deprecated.

| Concepto | Qué cambia en esta demo | Cómo comprobarlo |
| --- | --- | --- |
| Versión de API | El contrato HTTP v2 exige `reservation.status: "reserved"`; v1 conserva el JSON anterior. | Consulta el mismo `orderId` en `/v1/reservations/` y `/v2/reservations/`. |
| Versión de servicio | Dos despliegues de la misma imagen usan `SERVICE_VERSION=v1` y `v2`. | `docker compose ps inventory-v1 inventory-v2` y el header `X-Service-Version`. |

Después de iniciar sesión y crear un pedido con stock, guarda su `orderId` y ejecuta:

```sh
ORDER_ID=<uuid-del-pedido>
curl -i -b /tmp/mercadoya-cookies.txt "http://localhost:8000/api/inventory/v2/reservations/$ORDER_ID"
docker compose ps inventory-v1 inventory-v2
```

Para comparar compatibilidad, consulta explícitamente `/api/inventory/v1/reservations/$ORDER_ID` con la misma cookie. La respuesta v1 contiene `reservation.id`, `orderId`, `productId`, `quantity` y `createdAt`. La v2 añade `status: "reserved"`. Ambas consultas usan la misma cookie y la misma reserva. Sin cookie, las dos responden `401`.

## Guion de clase

Abre Swagger y expande las rutas v1 y v2 de `reservations`, con v1 marcada como deprecated. Compara sus schemas: solo v2 exige `reservation.status: "reserved"`. Abre también `:3005/docs` para mostrar el mismo contrato en dos procesos; sus healthchecks y `X-Service-Version` distinguen los despliegues.

Para ejecutar health desde `:3003/docs`, expande `/api/inventory/v1/health`, pulsa **Try it out** y selecciona el server directo `http://localhost:3003` en el selector general **Servers**; desde `:3005/docs`, expande la ruta v2, pulsa **Try it out** y selecciona `http://localhost:3005`. Así la solicitud usa el mismo origen. Reservations requieren sesión Better Auth: usa los comandos con cookie vía gateway de arriba para la prueba autenticada. Un `401` sin sesión o un bloqueo CORS al seleccionar otro origen en Swagger no impiden comparar los contratos.

Ejecuta `docker compose ps inventory-v1 inventory-v2` para mostrar los despliegues y sus puertos. Ejecuta `docker compose logs -f inventory-v2` durante un pedido para mostrar el consumo de `orders.placed` y la publicación del resultado. Compara con `apps/orders-service`, que arranca como proceso Node con `pnpm dev`. Ambos comparten NATS y PostgreSQL, pero Inventory tiene un runtime empaquetado y se comunica con Catalog por HTTP.

## Compensación de la saga

Solo v2 consume `payment.failed`. Busca la reserva por `orderId`, restaura en Catalog su `productId` y `quantity` persistidos, borra la reserva y publica `inventory.released`. Una reserva liberada responde `404` en ambas versiones HTTP. Un fallo sin reserva no ajusta stock ni publica liberación. Un lock transaccional PostgreSQL por pedido serializa reservas y liberaciones concurrentes; repetir el fallo no incrementa stock dos veces. Repetir `orders.placed` mientras existe la reserva tampoco vuelve a descontar stock.

Este laboratorio usa Core NATS, sin outbox ni reintentos durables. El ajuste HTTP de Catalog y la transacción de Inventory no son una transacción distribuida: una caída entre el ajuste, el commit y el publish puede requerir reconciliación manual. Al borrar la reserva no queda un historial durable que impida reservar de nuevo si se reenvía `orders.placed` después de compensar. La demo verifica duplicados de `payment.failed` durante una ejecución normal.

Tras cambiar el runtime, ejecuta `docker compose up -d --build inventory-v1 inventory-v2`. Ambos deben actualizarse para que el runtime antiguo v1 deje de consumir antes de activar el consumo v2. Para un cutover de una instalación anterior, detén primero ambos con `docker compose stop inventory-v1 inventory-v2`, reconstruye e inicia ambos, verifica health y reanuda la creación de pedidos. Core NATS no retiene eventos durante esa pausa.

## Deprecación HTTP

Desde el 30 de septiembre de 2026, las respuestas de rutas v1 incluyen `Deprecation: @1790726400` según [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html) y `Link` con `rel="successor-version"` hacia la ruta v2 equivalente. Kong conserva esos headers. OpenAPI marca las operaciones v1 como `deprecated: true` y documenta su sucesor. No se emite `Sunset` porque no hay fecha de retirada acordada. V1 conserva su JSON y health; el alias sin versión sirve v2 y exige migrar clientes que esperaban el JSON v1.
