# Notifications en AWS Lambda

Notifications recibe `orders.placed`, `inventory.reserved` e `inventory.rejected`. El handler valida el evento v1 con Zod, construye el destinatario y el mensaje, escribe un log JSON y envía `notification.stub` a `POST /api/events/ingest`. No entrega correo ni escribe en `notifications_messages`.

NATS no invoca Lambda por sí mismo. `src/bridge.ts` mantiene tres suscripciones NATS con grupos de cola distintos. Si `NOTIFICATIONS_FUNCTION_URL` está vacía, llama al mismo `handler` en el proceso local. Si tiene una URL, hace `POST` a la Function URL. Las reglas de notificación viven en `src/handler.ts`, fuera del bridge.

## Clase local sin AWS

Desde la raíz, copia `.env.example` a `.env` y reemplaza los dos tokens de Notifications por valores aleatorios distintos. Por ejemplo, ejecuta `openssl rand -hex 32` dos veces. Mantén `EVENTS_INGEST_URL=http://localhost:3001/api/events/ingest` y deja `NOTIFICATIONS_FUNCTION_URL` vacía.

```sh
pnpm install
docker compose up -d postgres nats
pnpm --filter @mercadoya/api db:push
docker compose up -d --build inventory
pnpm dev
```

`pnpm dev` inicia la web, API, Orders y el bridge. El bridge escucha en `:3004`; `GET http://localhost:3001/api/notifications/health` pasa por el proxy de la API. Crea un pedido desde la web o con `POST /api/orders`, y consulta `GET /api/events?orderId=<uuid>`. Deben aparecer `notification.stub` para el pedido recibido y para el resultado de Inventory. La timeline de la web usa el mismo endpoint.

El API solo acepta `notification.stub` con los campos esperados y exige `x-ingest-token`. El handler exige `x-invoke-token` tanto en local como por Function URL. Los tokens no se envían a la web.

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
  --parameters NotificationsInvokeToken="$NOTIFICATIONS_INVOKE_TOKEN"
```

`bootstrap` se ejecuta una vez por cuenta y región. El deploy devuelve `FunctionUrl`, `FunctionName`, `LogGroupName`, `AccountId` y `Region`. Copia `FunctionUrl` a `NOTIFICATIONS_FUNCTION_URL` en `.env` y reinicia el bridge. Crea otro pedido. En CloudWatch Logs, abre el grupo del output `LogGroupName` y busca `notification.created` y `notification.ingested`. La timeline muestra los mismos eventos por el ingest HTTP. Para volver al camino local, vacía `NOTIFICATIONS_FUNCTION_URL` y reinicia el bridge.

La Function URL usa `AuthType.NONE` para que el bridge docente pueda invocarla sin firma AWS. El handler rechaza peticiones sin `x-invoke-token`; aun así, la URL es pública y un tercero puede generar invocaciones con cargo. Usa tokens aleatorios, limita la duración del despliegue y destruye el stack después de clase. Los parámetros `NoEcho` evitan que CloudFormation muestre los tokens en sus outputs; usuarios con acceso a la configuración de Lambda pueden ver sus variables de entorno. Lambda y CloudWatch pueden generar cargos según la cuenta y el uso.

```sh
pnpm destroy
```

## Comportamiento y límites

Orders corre como proceso Node en `:3002`. Inventory corre como contenedor en `:3003`. Notifications ejecuta la lógica en Lambda cuando el bridge usa Function URL; en local invoca exactamente el mismo handler sin cuenta AWS. Los tres comparten los subjects NATS existentes.

El bridge usa NATS Core, con entrega como máximo una vez y sin persistencia ni reintento duradero. Si el handler o ingest falla, el bridge registra `event.handler_error`; el evento no se reproduce automáticamente. La timeline también es un buffer en memoria del API y se vacía al reiniciarlo. Este comportamiento basta para el recorrido de clase y no constituye entrega fiable de notificaciones.
