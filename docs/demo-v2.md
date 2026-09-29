# Demo MercadoYa V2: integración

Guion de preparación y checklist para la sesión de 50 minutos. Esta rama combina el pipeline local de imágenes, los módulos de dominio y los pedidos procesados por eventos. La demo S3→Lambda está aislada del flujo de MercadoYa.

## Antes de entrar

- [ ] Cambia a `v2-integration` e instala dependencias:

  ```sh
  git checkout v2-integration
  pnpm install
  ```

- [ ] Crea `.env` si aún no existe y cambia `BETTER_AUTH_SECRET` por una clave aleatoria de al menos 32 caracteres. Conserva `EVENT_BUS=nats` y `NATS_URL=nats://localhost:4222`.

  ```sh
  if [ ! -f .env ]; then cp .env.example .env; fi
  openssl rand -base64 48
  ```

  Guarda el resultado de `openssl` en `BETTER_AUTH_SECRET`. `.env.example` no contiene credenciales AWS.

- [ ] Inicia Postgres y NATS; confirma que ambos están activos:

  ```sh
  docker compose up -d
  docker compose ps
  ```

- [ ] En una base nueva, aplica el esquema y crea el admin una sola vez. El comando de creación está en [Autenticación local](../README.md#autenticación-local).

  ```sh
  pnpm --filter @mercadoya/api db:push
  ```

- [ ] Inicia la web y la API:

  ```sh
  pnpm dev
  ```

  La web queda en <http://localhost:5173> y la API en <http://localhost:3001>.

- [ ] Inicia sesión en <http://localhost:5173/login> con `admin@mercadoya.local` y `MercadoYaLocalAdmin2026!`. Crea o confirma que exista un producto con stock suficiente para la compra demo.

- [ ] Deja en el escritorio una imagen JPG, PNG o WebP válida de hasta 2 MiB y un archivo inválido, como `.txt` o una imagen mayor de 2 MiB. El formulario indica 5 MB, pero la API aplica el límite de 2 MiB.

- [ ] Deja el editor abierto en estos archivos:

  - `apps/api/src/api-layer.ts` y `apps/api/src/modules/` para el montaje de los seis módulos.
  - `apps/api/src/modules/media/pipeline/` para los filtros.
  - `apps/api/src/modules/orders/`, `inventory/` y `notifications/` para publicación y consumo de eventos.
  - `apps/api/src/db/schema.ts` y los `schema.ts` de cada módulo para las tablas.
  - `apps/web/src/routes/catalog.tsx`, `orders.$orderId.tsx` y `events.tsx` para compra y timeline.
  - `apps/cloud-pipeline-demo/cdk/lib/cloud-pipeline-demo-stack.ts` y `lambda/handler.ts` para el apéndice cloud.

- [ ] Para el bloque cloud, despliega el stack durante la preparación y anota el output `BucketName`. Ten abierta la consola AWS en ese bucket y en CloudWatch Logs, grupo `/aws/lambda/mercadoya-cloud-pipeline-demo-processor`. La app local no necesita sesión ni credenciales AWS.

## Guion de 50 minutos

| Minutos | Bloque | Acción y evidencia |
| --- | --- | --- |
| 0–4 | Apertura | Recuerda el paso de V0 naive a V1 modular y presenta los tres estilos de integración de esta sesión. |
| 4–8 | UI con Impeccable | Muestra catálogo y panel admin. La UI pulida ya está en esta rama. No hay una captura anterior versionada en `docs/ui-before/`; si no preparaste una captura, di que el resultado del trabajo con Impeccable quedó integrado antes de estas demos. |
| 8–11 | Mapa | Relaciona Media con pipeline, los seis módulos con service-based y `OrderPlaced` con event-driven. Aclara que el stack S3 es un apéndice aislado. |
| 11–19 | Módulos y API layer | Recorre el montaje de Hono, los contratos entre módulos y sus archivos de esquema. Explica que comparten una instancia de Postgres y que Orders no consulta tablas de Inventory. |
| 19–28 | Pipeline local | En `/admin/products`, sube el archivo inválido y muestra `Validate ✗` en la terminal de la API. Luego crea un producto con la imagen válida y muestra `Validate`, `Sanitize`, `Resize`, `Persist` y `Attach`. |
| 28–39 | Pedido y eventos | Abre `/events` y `/catalog`. Coloca un pedido con stock disponible. Muestra el estado confirmado y los eventos de `orders.placed`, `inventory.reserved` y notificación. Después provoca un rechazo por stock insuficiente y muestra su timeline. |
| 39–46 | Cloud aislada | En AWS Console sube una imagen a `inbox/`, muestra los logs de Lambda y comprueba el objeto resultante en `outbox/`. No ejecutes el CLI de CDK durante la clase. |
| 46–50 | Cierre | Resume cuándo usar pipeline, service-based y event-driven. Muestra `v1-modular` y `v2-integration` como snapshots de las sesiones. |

## Recorrido técnico

### UI y módulos

Muestra el catálogo en <http://localhost:5173/catalog> y el panel en <http://localhost:5173/admin/products>. La interfaz que se usa en los flujos de Media y Orders ya forma parte de `v2-integration`. Esta rama no incluye una captura de UI anterior.

En `apps/api/src/api-layer.ts`, Hono monta Identity, Catalog, Media, Orders, Inventory y Notifications dentro de un proceso API. Cada módulo mantiene sus tablas en su propio `schema.ts`; `apps/api/src/db/schema.ts` reúne esas tablas para una sola instancia Drizzle y una sola base PostgreSQL. Los archivos de esquema son propiedad de cada módulo, no esquemas PostgreSQL separados.

Orders publica `orders.placed`. Inventory consume ese evento y coordina el cambio de stock mediante el contrato de Catalog. Notifications también consume el evento. Catalog no se suscribe a `orders.placed`; Inventory usa el contrato de Catalog para consultar y ajustar el stock. Orders no importa el repositorio ni las tablas de Inventory. Los subjects y payloads están definidos junto a sus módulos.

### Pipeline local

El admin crea productos desde `/admin/products`; el catálogo público está en `/catalog`. La API acepta JPG, PNG y WebP de hasta 2 MiB. El límite se valida en `apps/api/src/modules/media/pipeline/validate.ts`; el texto del formulario aún indica 5 MB. Usa un archivo válido menor de 2 MiB para el camino feliz.

Para el fallo, elige el archivo `.txt` desde el selector de archivos o usa una imagen demasiado grande. La terminal de la API muestra `Validate ✗` y la respuesta indica por qué se rechazó el archivo.

Para el camino feliz, publica un producto con la imagen válida. La terminal muestra los cinco filtros en orden. Media guarda los archivos `*-full.*` y `*-thumb.*` bajo `apps/api/uploads/media/`. El contrato de Media produce `imageUrl` y `thumbUrl`, pero el registro de Catalog persiste solo `imagePath`; la vista del catálogo sirve la imagen completa a partir de ese campo.

### Pedido, timeline y stock insuficiente

Abre <http://localhost:5173/events> en una pestaña y <http://localhost:5173/catalog> en otra. Coloca un pedido de una o más unidades disponibles. La vista del pedido abre `/orders/<orderId>` y muestra el estado confirmado y su timeline. El listado general también consulta `GET /api/events`; conserva hasta 100 eventos en memoria desde que inició la API.

Para demostrar el rechazo, el formulario impide enviar una cantidad mayor al stock que muestra. Usa el endpoint para crear un pedido de prueba con cantidad superior al stock disponible:

```sh
curl -sS -H 'Content-Type: application/json' \
  -d '{"productId":"UUID_DEL_PRODUCTO","quantity":999999}' \
  http://localhost:3001/api/orders
```

La respuesta incluye el UUID del pedido. Ábrelo en `http://localhost:5173/orders/UUID_DEL_PEDIDO` para mostrar el rechazo y su timeline. También puedes consultar `GET /api/events?orderId=UUID_DEL_PEDIDO`.

Los consumidores conectados en `apps/api/src/api-layer.ts` son:

- `orders.placed`: Inventory reserva stock y Notifications registra el pedido.
- `inventory.reserved`: Orders confirma el pedido y Notifications registra la confirmación.
- `inventory.rejected`: Orders rechaza el pedido y Notifications registra el rechazo.

El envío de notificaciones es un stub, no un correo real.

### Cloud aislada

La demo cloud está en [`apps/cloud-pipeline-demo`](../apps/cloud-pipeline-demo/README.md). El stack ya debe estar desplegado antes de entrar. En AWS Console:

1. Abre el bucket anotado en el output `BucketName` y sube una imagen de hasta 5 MiB dentro de `inbox/`.
2. En CloudWatch Logs, abre `/aws/lambda/mercadoya-cloud-pipeline-demo-processor` y muestra `Validate`, `Transform` y `Persist`.
3. Regresa a S3 y comprueba el resultado dentro de `outbox/`.

El trigger escucha objetos en `inbox/`. MercadoYa no envía imágenes a S3 y `pnpm dev` no depende de credenciales AWS. Para el despliegue y la limpieza del stack, sigue el README del paquete cloud fuera del horario de clase.

## Plan B

- Si NATS no está disponible al iniciar la API, el bootstrap usa el transporte in-process como fallback. Para seleccionarlo explícitamente, cambia `EVENT_BUS=inprocess` en `.env` y reinicia la API.
- Si AWS o la consola falla, omite el bloque cloud y explica que el paquete CDK muestra el mismo estilo pipeline en un runtime aislado.
- Si falla la carga inválida, muestra `validate.ts` y continúa con la imagen válida.

## Credenciales y snapshots

Credenciales locales del admin: `admin@mercadoya.local` / `MercadoYaLocalAdmin2026!`. `.env` es local e ignorado por Git; `EVENT_BUS` y `NATS_URL` están documentados en [`.env.example`](../.env.example). No agregues credenciales AWS a MercadoYa.

La rama `v0-naive` conserva el snapshot V0 y `v1-modular` conserva V1. Ambas ramas se mantienen aparte de `v2-integration`.
