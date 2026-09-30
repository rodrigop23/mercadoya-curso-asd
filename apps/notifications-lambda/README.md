# Notifications en AWS Lambda

Notifications recibe solo los desenlaces `payment.succeeded`, `inventory.rejected` y `payment.failed`. Valida los eventos con los schemas de `@mercadoya/contracts`, renderiza tres templates React Email en español y envía HTML y texto con Resend. Después registra el resultado en `POST /api/events/ingest`. No escribe en `notifications_messages`.

| Subject | Template | Asunto |
| --- | --- | --- |
| `payment.succeeded` | `order-confirmed` | Pedido confirmado |
| `inventory.rejected` | `order-rejected-stock` | No pudimos completar tu pedido |
| `payment.failed` | `order-rejected-payment` | El pago no se completó |

El bridge no se suscribe a `orders.placed`, `inventory.reserved` ni `inventory.released`. Si llegan directamente al handler autenticado, responde 202 sin enviar ni ingestar. La reserva de stock no confirma un pedido.

NATS no invoca Lambda por sí mismo. `src/bridge.ts` mantiene tres suscripciones NATS con grupos de cola distintos. Si `NOTIFICATIONS_FUNCTION_URL` está vacía, llama al mismo `handler` en el proceso local. Si tiene una URL, hace `POST` a la Function URL. Las reglas de notificación viven en `src/handler.ts`, fuera del bridge.

## Clase local sin AWS

Desde la raíz, copia `.env.example` a `.env` y reemplaza los dos tokens de Notifications por valores aleatorios distintos. Por ejemplo, ejecuta `openssl rand -hex 32` dos veces. Mantén `EVENTS_INGEST_URL=http://localhost:3001/api/events/ingest` y deja `NOTIFICATIONS_FUNCTION_URL` vacía.

```sh
pnpm install
docker compose up -d postgres nats
pnpm --filter @mercadoya/api db:push
docker compose up -d --build inventory-v1 inventory-v2
pnpm dev
```

`pnpm dev` inicia la web, API, Orders y el bridge. El bridge escucha en `:3004`; `GET http://localhost:3001/api/notifications/health` pasa por el proxy de la API. Crea un pedido desde la web o con `POST /api/orders`, y consulta `GET /api/events?orderId=<uuid>`. Debe aparecer una notificación de desenlace por pedido, `notification.stub` en modo stub o `notification.email` cuando se intenta enviar correo. `emailStatus` distingue `stub`, `sent` y `error`. La timeline de la web usa el mismo endpoint.

El API acepta `notification.stub` y `notification.email` de los tres desenlaces con los campos esperados y exige `x-ingest-token`. El handler exige `x-invoke-token` tanto en local como por Function URL. Los tokens no se envían a la web.

## Correo real y smoke

Configura las siguientes variables en `.env` y reinicia el bridge:

```dotenv
RESEND_API_KEY=re_TU_KEY
RESEND_FROM=MercadoYa <pedidos@TU_DOMINIO_VERIFICADO>
DEMO_NOTIFY_EMAIL=tu-correo@example.com
EMAIL_MODE=resend
```

Crea la key en Resend y verifica el dominio del remitente según la [guía oficial](https://resend.com/docs/send-with-nodejs). Los templates se convierten a HTML y texto con [React Email render](https://react.email/docs/utilities/render). No guardes la key en Git.

`EMAIL_MODE` vacío selecciona `resend` si existe key y `stub` si no existe. `EMAIL_MODE=stub` permite simular aunque haya key. Sin destinatario, el handler registra `stubReason=missing_recipient` y mantiene el 202 tras ingest. Si fuerzas `resend` con destinatario pero sin key o remitente, registra `emailError=true`.

Todos los pedidos usan `DEMO_NOTIFY_EMAIL`, también cuando tienen `buyerId`. Identity solo expone la sesión autenticada y no tiene un endpoint interno de búsqueda de correo por ID. El handler no interpreta un ID como dirección de correo.

Para comprobar los tres correos:

1. Con `PAYMENT_MODE=succeed`, crea un pedido desde la UI con stock suficiente. Espera "Pedido confirmado" después de `payment.succeeded`.
2. Con `PAYMENT_MODE=fail`, reinicia Orders y crea otro pedido con stock suficiente. Espera "El pago no se completó" con el motivo del fallo. Inventory libera el stock por separado.
3. Pide más unidades que el stock disponible. Espera "No pudimos completar tu pedido" con el motivo de Inventory. Devuelve `PAYMENT_MODE` a `succeed`.

También puedes ejecutar `pnpm demo:saga` con un producto de clase y stock suficiente. Sus pedidos tienen `buyerId: null`: solo prueba el inbox si configuraste key, remitente y `DEMO_NOTIFY_EMAIL` y el modo permite Resend. Consulta la timeline por cada ID del CLI. El CLI publica fallos duplicados para comprobar la compensación. Cada envío usa una clave de idempotencia por subject y pedido; Resend evita repetir el mismo correo dentro de su ventana de idempotencia, pero pueden aparecer registros duplicados en la timeline. Estos son tres tipos de correo, uno por desenlace, no tres correos en cada pedido.

```sh
pnpm --filter @mercadoya/contracts build
pnpm --filter @mercadoya/notifications-lambda test
pnpm --filter @mercadoya/notifications-lambda typecheck
pnpm --filter @mercadoya/notifications-lambda lint
pnpm --filter @mercadoya/notifications-lambda build
```

Los tests interceptan HTTP y no entregan correo real.

## Despliegue docente

El stack crea una Lambda Node.js 22, una Function URL y el log group `/aws/lambda/mercadoya-notifications` con retención de una semana. Usa la misma versión de runtime que `apps/cloud-pipeline-demo`, pero es un stack independiente. Necesitas una cuenta y región AWS, credenciales para CDK y una URL HTTPS pública para el API local o desplegado. Una Lambda en AWS no puede llamar a `localhost:3001`: publica el API mediante un túnel HTTPS durante la clase o usa un API desplegado. `EVENTS_INGEST_URL` debe terminar en `/api/events/ingest`.

Desde `apps/notifications-lambda`, con el perfil AWS correcto:

```sh
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION="us-east-1"
export EVENTS_INGEST_URL="https://TU_API_PUBLICA/api/events/ingest"
# NOTIFICATIONS_INGEST_TOKEN y NOTIFICATIONS_INVOKE_TOKEN deben coincidir con .env.
pnpm bootstrap
pnpm deploy --parameters EventsIngestUrl="$EVENTS_INGEST_URL" \
  --parameters NotificationsIngestToken="$NOTIFICATIONS_INGEST_TOKEN" \
  --parameters NotificationsInvokeToken="$NOTIFICATIONS_INVOKE_TOKEN" \
  --parameters ResendApiKey="$RESEND_API_KEY" \
  --parameters ResendFrom="$RESEND_FROM" \
  --parameters DemoNotifyEmail="$DEMO_NOTIFY_EMAIL" \
  --parameters EmailMode="${EMAIL_MODE:-}"
```

Los parámetros de correo tienen defaults vacíos para modo stub. La key usa `NoEcho` y se entrega a Lambda por variable de entorno. CDK empaqueta el handler, contracts, React Email y los templates TSX con esbuild. La Lambda no lee el `.env` local.

`bootstrap` se ejecuta una vez por cuenta y región. El deploy devuelve `FunctionUrl`, `FunctionName`, `LogGroupName`, `AccountId` y `Region`. Copia `FunctionUrl` a `NOTIFICATIONS_FUNCTION_URL` en `.env` y reinicia el bridge. Crea otro pedido. En CloudWatch Logs, abre el grupo del output `LogGroupName` y busca `notification.created` y `notification.ingested`. La timeline muestra los mismos eventos por el ingest HTTP. Para volver al camino local, vacía `NOTIFICATIONS_FUNCTION_URL` y reinicia el bridge.

La Function URL usa `AuthType.NONE` para que el bridge docente pueda invocarla sin firma AWS. El handler rechaza peticiones sin `x-invoke-token`; aun así, la URL es pública y un tercero puede generar invocaciones con cargo. Usa tokens aleatorios, limita la duración del despliegue y destruye el stack después de clase. Los parámetros `NoEcho` evitan que CloudFormation muestre los tokens en sus outputs; usuarios con acceso a la configuración de Lambda pueden ver sus variables de entorno. Lambda y CloudWatch pueden generar cargos según la cuenta y el uso.

```sh
pnpm destroy
```

## Comportamiento y límites

Orders corre como proceso Node en `:3002`. Inventory corre como contenedor en `:3003`. Notifications ejecuta la lógica en Lambda cuando el bridge usa Function URL; en local invoca exactamente el mismo handler sin cuenta AWS. Los tres comparten los subjects NATS existentes.

El bridge usa NATS Core, con entrega como máximo una vez y sin persistencia ni reintento duradero. Si el handler o ingest falla, el bridge registra `event.handler_error`; el evento no se reproduce automáticamente. La timeline también es un buffer en memoria del API y se vacía al reiniciarlo. Este comportamiento basta para el recorrido de clase y no constituye entrega fiable de notificaciones.

Resend tiene un timeout de 5 segundos. Si rechaza el envío, falla la red o falta configuración, el handler registra el error e ingesta `emailStatus=error` y `emailError=true`; responde 202 si ingest funciona. `sent` significa que Resend aceptó el envío, no que el inbox lo recibió. No hay reintento de correo ni rollback de la saga. Un fallo de ingest sigue produciendo error del consumidor. El correo y la timeline no forman una transacción: un envío aceptado puede quedar sin registro si ingest falla.
