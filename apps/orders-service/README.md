# Orders y pagos Polar

Orders es un proceso Node/Hono en `:3002`. Publica `orders.placed`, crea el checkout al recibir `inventory.reserved` y mantiene el pedido en `pending` hasta recibir `payment.succeeded` o un rechazo. Polar es el único proveedor, con sandbox por defecto.

## Preparar sandbox

Crea una organización dedicada a MercadoYa en [Polar sandbox](https://sandbox.polar.sh). Sus productos, tokens y webhooks son independientes de producción. Configura el `.env` de la raíz siguiendo [`.env.example`](../../.env.example), con `PAYMENT_PROVIDER=polar`, `POLAR_SERVER=sandbox`, `POLAR_WEB_ORIGIN=http://localhost:5173` y tu `POLAR_ACCESS_TOKEN` de organización sandbox. El token necesita `products:write`, `organizations:write` y `checkouts:read/write`. El secreto del webhook se obtiene en el paso 2. Todos los comandos siguientes se ejecutan desde la raíz del repositorio.

### 1. Levantar Cloudflare Tunnel hacia Kong

Instala `cloudflared` una sola vez. En macOS con Homebrew:

```sh
brew install cloudflared
```

Para otros sistemas, usa las [descargas oficiales de Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). En una terminal separada de `pnpm dev`, inicia un Quick Tunnel hacia Kong en el puerto 8000:

```sh
cloudflared tunnel --url http://localhost:8000
```

Copia la URL HTTPS `https://<nombre-del-tunel>.trycloudflare.com` que imprime el proceso y mantén esa terminal abierta durante las pruebas. Este túnel temporal no requiere cuenta ni dominio de Cloudflare; la URL deja de funcionar al detenerlo y cambia al crear otro túnel. Si lo reinicias, actualiza la URL del endpoint en Polar. [Guía oficial de Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

La URL que debes registrar en Polar incluye la ruta completa:

```text
https://<nombre-del-tunel>.trycloudflare.com/api/payments/polar/webhook
```

Registrar solo la raíz del túnel provoca `404` en Kong. Usa esta ruta sin barra final ni redirects. El webhook es público y verifica la firma de Polar, sin JWT de usuario. `POLAR_WEB_ORIGIN` sigue apuntando a la web local en `:5173`, porque controla el regreso del comprador.

### 2. Configurar el webhook y guardar el secret

1. Entra a [Polar sandbox](https://sandbox.polar.sh), selecciona tu organización y abre **Settings → Webhooks**. La página está en `https://sandbox.polar.sh/dashboard/<tu-organizacion>/settings/webhooks`.
2. Pulsa **Add Endpoint**. Si ya tienes el endpoint de MercadoYa, edítalo para actualizar su URL.
3. Introduce la URL completa del túnel con `/api/payments/polar/webhook`. Selecciona formato **Raw**, versión de API **2026-04** y estos eventos: `order.paid`, `order.updated`, `checkout.updated` y `checkout.expired`.
4. Copia el **Secret** del endpoint que muestra o genera Polar. Guarda el endpoint y comprueba que esté habilitado.
5. Pega ese valor en `POLAR_WEBHOOK_SECRET` dentro del `.env` de la raíz. Sustituye el marcador del ejemplo por el secret real, conservando su valor literal:

   ```dotenv
   POLAR_WEBHOOK_SECRET="<secret-del-endpoint>"
   ```

`POLAR_WEBHOOK_SECRET` es el secreto de firma de ese endpoint, distinto del access token de la organización. Se pasa directamente al SDK, sin convertirlo a Base64. Guarda las credenciales solo en `.env`, sin variables `VITE_*`, commits ni logs. [Configuración oficial de webhooks](https://polar.sh/docs/integrate/webhooks/endpoints).

### 3. Iniciar los servicios o recargar el secret

Con `.env` completo, la primera puesta en marcha aplica las migraciones y levanta infraestructura y backends:

```sh
pnpm demo:infra
```

En otra terminal, inicia la web y el microfrontend de administración:

```sh
pnpm dev
```

Si los servicios ya están levantados y acabas de guardar o cambiar `POLAR_WEBHOOK_SECRET`, recrea únicamente Orders para que lea el nuevo entorno:

```sh
docker compose up -d --force-recreate --no-deps orders
```

`docker compose restart orders` conserva las variables del contenedor anterior. `pnpm dev` solo inicia los frontends. El comando de recreación carga el secret actualizado desde `.env`; no requiere reconstruir la imagen ni reiniciar el túnel.

### 4. Comprar con la tarjeta de prueba

Crea un producto desde el admin y espera a que termine su sincronización con Polar. Compra desde el catálogo y pulsa **Pagar en Polar** en la página del pedido, después de la reserva y la creación del checkout. La [documentación oficial de sandbox](https://polar.sh/docs/integrate/sandbox) indica estos datos para probar un pago exitoso:

| Dato        | Valor de prueba                             |
| ----------- | ------------------------------------------- |
| Número      | `4242 4242 4242 4242`                       |
| Vencimiento | Cualquier fecha futura, por ejemplo `12/30` |
| CVC         | Cualquier CVC válido, por ejemplo `123`     |

Úsala en Polar sandbox, donde no se procesa dinero real. Los precios y checkouts de MercadoYa usan soles peruanos `PEN`.

El regreso del navegador muestra el pedido; la confirmación depende del webhook. En **Settings → Webhooks**, abre el endpoint y revisa **Deliveries**. Un `202` significa que Orders aceptó el evento para procesarlo en segundo plano; `order.paid` produce `payment.succeeded` y confirma el pedido.

Si Polar muestra el pago realizado pero MercadoYa sigue pendiente, revisa la entrega de `order.paid`. Un `404` suele indicar una URL o ruta incorrecta; un `403` del handler indica un problema de firma, así que comprueba el secret y recrea Orders. Después de corregirlo, abre esa entrega y pulsa **Redeliver** para reenviar el evento existente. No necesitas pagar de nuevo; el inbox deduplica por event id. [Supervisión y reentrega de webhooks](https://polar.sh/docs/integrate/webhooks/delivery).

Como alternativa al túnel, Polar CLI puede reenviar a `http://localhost:8000/api/payments/polar/webhook`; en ese caso usa su secreto de forwarding.

## Configuración del servidor

| Variable                                     | Uso                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PAYMENT_PROVIDER`                           | Solo `polar`, por defecto; cualquier otro valor impide arrancar.                                                                   |
| `POLAR_SERVER`                               | `sandbox` por defecto; `production` es una selección explícita.                                                                    |
| `POLAR_ACCESS_TOKEN`                         | Token de organización para Catalog y Orders con products:write, organizations:write y checkouts:read/write. Solo env del servidor. |
| `POLAR_WEBHOOK_SECRET`                       | Secreto del endpoint o del forwarder. Se pasa literalmente al SDK.                                                                 |
| `POLAR_WEB_ORIGIN`                           | Origen de la web para success/return, por defecto `http://localhost:5173`.                                                         |
| `DATABASE_URL`                               | PostgreSQL compartido con Catalog/Inventory.                                                                                       |
| `EVENT_BUS`, `NATS_URL`                      | `nats`, por defecto `nats://localhost:4222`.                                                                                       |
| `IDENTITY_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` | Verificación JWKS, igual que los demás servicios.                                                                                  |

Catalog sincroniza automáticamente con Polar al crear, actualizar o eliminar un producto en el aplicativo. La sincronización ocurre en segundo plano: crea o actualiza título, descripción y precio; al eliminar, archiva el equivalente en Polar. Guarda la relación en PostgreSQL por sandbox/producción y recupera productos existentes al iniciar. No necesitas crear los productos manualmente en Polar ni declarar un JSON en variables de entorno. [Detalles de sincronización y recuperación](../catalog-service/README.md#sincronización-con-polar).

Todos los precios nuevos usan **soles peruanos PEN**, sin conversión. Por ejemplo, S/ 12.34 se guarda como `unitAmount: 1234`; dos unidades crean un checkout de 2468 céntimos, S/ 24.68 antes de impuestos. Los precios fijos usan `tax_behavior: exclusive`, sin descuentos ni trials. El checkout muestra los impuestos aplicables. El rango unitario es S/ 2.00 a S/ 999,999.99; el total tampoco puede superar ese máximo. El formulario admin y el backend validan estos límites.

El cliente oficial está fijado a `@polar-sh/sdk@1.0.1`. Importa `createPolar` y `webhooks` desde `@polar-sh/sdk/2026-04`, usa `environment` y campos API `snake_case`. El ejemplo del skill con `new Polar` y campos `camelCase` corresponde al SDK anterior. Selecciona la misma versión **2026-04** en el endpoint del dashboard; la firma no acredita una versión de payload diferente.

## HTTP y persistencia

- `POST /api/orders` acepta producto y cantidad autenticados, devuelve `202` y el pedido. Descarta cualquier importe, moneda o metadata del cliente. Consulta Catalog por HTTP interno y guarda el precio PEN antes de publicar. Producto inexistente devuelve 404, sincronización pendiente/fallida o importe excesivo devuelve 409 y Catalog inaccesible devuelve 503. Estos rechazos no reservan stock.
- `GET /api/orders/:orderId/checkout` requiere sesión/JWT y ser el comprador. Devuelve `202` con `checkout: null` mientras se prepara, o `200` con ID, URL, expiración, importe y moneda. Usa `Cache-Control: no-store`. Otro comprador recibe `404`.
- `POST /api/payments/polar/webhook` es público en Kong y Orders. Verifica firma y timestamp sobre el cuerpo original antes de parsear. Una firma inválida devuelve `403`, un payload inválido `400` y un cuerpo mayor de 256 KiB `413`.
- Un evento aceptado devuelve `202` después de persistir su resultado normalizado en el inbox. Si PostgreSQL no lo acepta, devuelve `503` para permitir reentrega. La respuesta no espera checkout, NATS, Inventory ni correo.

Standard Webhooks firma `webhook-id.timestamp.rawBody`. La URL no forma parte del HMAC, pero debe ser la URL final registrada: Polar no sigue redirects. Kong conserva path, body y headers. El SDK admite secretos Standard Webhooks actuales y secretos Polar HMAC anteriores al 8 de septiembre de 2026. No convertir, serializar de nuevo ni registrar el cuerpo antes de verificarlo.

Las tablas históricas `orders_order` e `inventory_reservations` siguen en las migraciones de Catalog. Payments añade `orders_payment_checkout` y `orders_payment_webhook`, y campos JSON de precio guardado en `orders_order` y el job de checkout, con migraciones propias, repetibles y aditivas:

```sh
pnpm --filter @mercadoya/catalog-service db:migrate
pnpm --filter @mercadoya/orders-service db:migrate
```

`pnpm demo:infra` aplica ambas. Payments guarda el precio unitario y UUID Polar obtenidos de Catalog, la reserva, datos del enlace y el resultado normalizado. El precio permanece fijo aunque Catalog cambie después. Los checkouts ya abiertos conservan su precio y moneda anteriores; un pedido histórico sin precio guardado que todavía no creó checkout falla y compensa. No guarda access token, webhook secret, firma, raw payload, datos de tarjeta ni `client_secret`. Los errores del SDK se reducen a códigos de operación antes de registrarlos.

## Eventos y compensación

Los subjects y `version: 1` se conservan. Los resultados de pago y `inventory.released` añaden campos opcionales `provider: "polar"`, `eventId`, `checkoutId` y `providerOrderId`. `eventId` viene de **webhook-id**, que se repite en reintentos; no es `event.data.id`. Polar recibe `metadata.order_id`, que identifica el pedido local, y `order.paid.data.checkout_id` identifica la sesión Polar. Inventory libera usando el `orderId` actual y conserva la correlación en `inventory.released`. Notifications sigue validando los contratos v1 y enviando por desenlace.

| Entrada Polar                                                                                  | Resultado saga                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `order.paid`, con `paid=true`, estado `paid`, checkout e importe/moneda coincidentes           | `payment.succeeded`; Orders confirma y conserva el stock reservado. |
| `checkout.updated`, estado `failed`                                                            | `payment.failed`, razón `polar_checkout_failed`.                    |
| `checkout.expired` o `checkout.updated`, estado `expired`                                      | `payment.failed`, razón `polar_checkout_expired`.                   |
| `order.updated`, estado `void`, sin pago                                                       | `payment.failed`, razón `polar_order_void`.                         |
| Rechazo definitivo de Checkout API                                                             | `payment.failed`, con razón de creación; Inventory compensa.        |
| `checkout.updated`, estado `open`, `confirmed` o `succeeded`; órdenes pendientes y demás tipos | Sin confirmación ni compensación. Se espera `order.paid`.           |

Todos los fallos terminales activan la regla existente de Inventory v2: restaurar stock una vez, eliminar la reserva y publicar `inventory.released`. El rechazo y el correo pueden aparecer antes de la liberación. Polar no define `checkout.canceled`: volver al comercio o cerrar la pestaña mantiene la reserva hasta la expiración; una orden anulada usa `void`. Cancelaciones de suscripciones y reembolsos posteriores al pago no representan un fallo de esta compra única.

## Reintentos y límites

El inbox deduplica por event id en PostgreSQL, también después de reiniciar y ante entregas concurrentes. Un worker procesa en serie y toma un advisory lock compartido entre réplicas antes de llamar a Polar o publicar. Orders usa queue groups NATS para el worker Polar. El primer resultado terminal de un checkout queda fijado; eventos tardíos, repetidos, de otra sesión o con importe distinto no cambian el pedido ni liberan stock.

El worker publica antes del commit y reintenta los fallos de publicación desde el inbox. Una caída después de publicar y antes del commit puede repetir el mismo evento con el mismo `eventId`. Orders y la compensación de Inventory ya son idempotentes. Esta es entrega **at-least-once desde el inbox al publisher**, no una garantía de recepción para consumidores desconectados. NATS Core no guarda ni reproduce mensajes; `flush()` no es un ACK del consumidor. Tampoco recupera automáticamente `orders.placed`/`inventory.reserved` perdidos durante una desconexión. No se añadió outbox ni JetStream.

Una creación de checkout con error de red/5xx puede haber completado en Polar. Orders conserva `creating` y busca la sesión por `metadata.order_id` cada 30 segundos, sin emitir un segundo POST ni liberar una reserva que todavía podría cobrarse. Si la llamada nunca llegó a Polar, un operador debe comprobarlo antes de reactivar ese intento. `payment.checkout_uncertain` identifica el pedido que requiere esa comprobación; no incluye secretos. Si falta la entrega de un webhook, reenvíala desde el dashboard con el mismo event id. Supervisa `payment.webhook_retry` y `payment.outcome_ignored`.

Polar puede reintentar entregas hasta diez veces, aplica timeout de diez segundos y recomienda responder antes de dos segundos. Diez entregas consecutivas fallidas pueden deshabilitar el endpoint. El worker conserva los eventos ya aceptados independientemente de esos reintentos.

## Pruebas y demo histórica

```sh
pnpm exec turbo run test --filter=@mercadoya/orders-service --filter=@mercadoya/contracts
# PostgreSQL y NATS dedicados; la suite crea y elimina su propio schema.
PAYMENTS_TEST_DATABASE_URL=<url-test> PAYMENTS_TEST_NATS_URL=<url-test> pnpm --filter @mercadoya/orders-service test:integration
```

CI ejecuta firma actual y legacy, raw body alterado, timestamps, payload inválido, solicitud SDK y configuración exclusiva de Polar. El job `polar-saga` usa Catalog con su API interna HTTP, PostgreSQL/NATS reales y gateways Polar de prueba: verifica sincronización, precio PEN guardado ante cambios posteriores, éxito, fallo, expiración, anulación, duplicados, importe/correlación, reinicio del worker, creación incierta, compensación y el handler real de Notifications en modo stub. No usa credenciales Polar ni cobra contra sandbox. El smoke de Kong verifica el rechazo sin producto Polar sincronizado; su fixture de CI devuelve 401 al SDK de Catalog.

El [CLI de demo](../../scripts/README.md) crea pedidos por Kong, muestra el checkout Polar sandbox y espera el webhook firmado. La implementación histórica permanece en el rama `v3-services`.

## Documentación oficial verificada

Consultada el 1 de octubre de 2026 y contrastada con el SDK instalado: [endpoints](https://polar.sh/docs/integrate/webhooks/endpoints), [delivery y firmas](https://polar.sh/docs/integrate/webhooks/delivery), [eventos](https://polar.sh/docs/integrate/webhooks/events), [SDK TypeScript](https://polar.sh/docs/integrate/sdk/typescript), [Checkout API 2026-04](https://polar.sh/docs/api-reference/2026-04/checkouts/create-checkout-session), [sandbox](https://polar.sh/docs/integrate/sandbox) y [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
