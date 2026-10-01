# Notifications en AWS Lambda

Notifications recibe solo los desenlaces `payment.succeeded`, `inventory.rejected` y `payment.failed`. Valida los eventos con los schemas de `@mercadoya/contracts`, renderiza tres templates React Email en español y envía HTML y texto con Resend. Registra el resultado en logs. No escribe en `notifications_messages`.

| Subject              | Template                 | Asunto                         |
| -------------------- | ------------------------ | ------------------------------ |
| `payment.succeeded`  | `order-confirmed`        | Pedido confirmado              |
| `inventory.rejected` | `order-rejected-stock`   | No pudimos completar tu pedido |
| `payment.failed`     | `order-rejected-payment` | El pago no se completó         |

El bridge no se suscribe a `orders.placed`, `inventory.reserved` ni `inventory.released`. Si llegan directamente al handler autenticado, responde 202 sin enviar correo. La reserva de stock no confirma un pedido.

NATS no invoca Lambda por sí mismo. `src/bridge.ts` mantiene tres suscripciones NATS con grupos de cola distintos. Si `NOTIFICATIONS_FUNCTION_URL` está vacía, llama al mismo `handler` en el proceso local. Si tiene una URL, hace `POST` a la Function URL. Las reglas de notificación viven en `src/handler.ts`, fuera del bridge.

## Clase local sin AWS

Desde la raíz, copia `.env.example` a `.env` y asigna un valor aleatorio a `NOTIFICATIONS_INVOKE_TOKEN` y deja `NOTIFICATIONS_FUNCTION_URL` vacía.

```sh
pnpm install
pnpm demo:infra
pnpm dev
```

`pnpm dev` inicia la web y el MF. Compose ejecuta los servicios. El bridge escucha en `:3004`; su health público está en `http://localhost:8000/api/notifications/health`. Crea un pedido desde la web y revisa `docker compose logs notifications` para ver `notification.created`, `notification.stub` o `notification.email`, con `emailStatus` igual a `stub`, `sent` o `error`.

El handler exige `x-invoke-token` tanto en local como por Function URL. El token no se envía a la web.

## Correo real y smoke

Configura las siguientes variables en `.env` y reinicia el bridge:

```dotenv
RESEND_API_KEY=re_TU_KEY
RESEND_FROM=MercadoYa <pedidos@TU_DOMINIO_VERIFICADO>
DEMO_NOTIFY_EMAIL=tu-correo@example.com
EMAIL_MODE=resend
```

Crea la key en Resend y verifica el dominio del remitente según la [guía oficial](https://resend.com/docs/send-with-nodejs). Los templates se convierten a HTML y texto con [React Email render](https://react.email/docs/utilities/render). No guardes la key en Git.

`EMAIL_MODE` vacío selecciona `resend` si existe key y `stub` si no existe. `EMAIL_MODE=stub` permite simular aunque haya key. Sin destinatario, el handler registra `stubReason=missing_recipient` y mantiene el 202. Si fuerzas `resend` con destinatario pero sin key o remitente, registra `emailError=true`.

Todos los pedidos usan `DEMO_NOTIFY_EMAIL`, también cuando tienen `buyerId`. Identity solo expone la sesión autenticada y no tiene un endpoint interno de búsqueda de correo por ID. El handler no interpreta un ID como dirección de correo.

Para comprobar los tres correos:

1. Configura [Polar sandbox](../orders-service/README.md), crea un pedido con stock y completa su checkout. Espera "Pedido confirmado" después del webhook `order.paid` y `payment.succeeded`.
2. Crea otro pedido y deja expirar su checkout o anula la orden en Polar sandbox. Espera "El pago no se completó". Inventory libera el stock por separado.
3. Pide más unidades que el stock disponible en un producto sincronizado. Espera "No pudimos completar tu pedido" con el motivo de Inventory.

La suite `polar-saga` de CI verifica los tres desenlaces y los duplicados con el handler real en modo stub.

También puedes ejecutar `pnpm demo:saga` con un producto de clase y stock suficiente. Sus pedidos tienen `buyerId: null`: solo prueba el inbox si configuraste key, remitente y `DEMO_NOTIFY_EMAIL` y el modo permite Resend. Consulta los logs de Notifications por cada ID del CLI. El CLI publica fallos duplicados para comprobar la compensación. Cada envío usa una clave de idempotencia por subject y pedido; Resend evita repetir el mismo correo dentro de su ventana de idempotencia, pero pueden aparecer registros duplicados en los logs. Estos son tres tipos de correo, uno por desenlace, no tres correos en cada pedido.

```sh
pnpm --filter @mercadoya/contracts build
pnpm --filter @mercadoya/notifications-lambda test
pnpm --filter @mercadoya/notifications-lambda typecheck
pnpm --filter @mercadoya/notifications-lambda lint
pnpm --filter @mercadoya/notifications-lambda build
```

Los tests interceptan HTTP y no entregan correo real.

## Despliegue docente

El stack crea una Lambda Node.js 22, una Function URL y el log group `/aws/lambda/mercadoya-notifications` con retención de una semana. Usa la misma versión de runtime que `apps/cloud-pipeline-demo`, pero es un stack independiente. Necesitas una cuenta y región AWS y credenciales para CDK. El handler envía correo y escribe logs sin depender de un servicio de eventos HTTP.

Desde `apps/notifications-lambda`, con el perfil AWS correcto:

```sh
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION="us-east-1"
# NOTIFICATIONS_INVOKE_TOKEN debe coincidir con .env.
pnpm bootstrap
pnpm deploy --parameters NotificationsInvokeToken="$NOTIFICATIONS_INVOKE_TOKEN" \
  --parameters ResendApiKey="$RESEND_API_KEY" \
  --parameters ResendFrom="$RESEND_FROM" \
  --parameters DemoNotifyEmail="$DEMO_NOTIFY_EMAIL" \
  --parameters EmailMode="${EMAIL_MODE:-}"
```

Los parámetros de correo tienen defaults vacíos para modo stub. La key usa `NoEcho` y se entrega a Lambda por variable de entorno. CDK empaqueta el handler, contracts, React Email y los templates TSX con esbuild. La Lambda no lee el `.env` local.

`bootstrap` se ejecuta una vez por cuenta y región. El deploy devuelve `FunctionUrl`, `FunctionName`, `LogGroupName`, `AccountId` y `Region`. Copia `FunctionUrl` a `NOTIFICATIONS_FUNCTION_URL` en `.env` y reinicia el bridge. Crea otro pedido. En CloudWatch Logs, abre el grupo del output `LogGroupName` y busca `notification.created`. Para volver al camino local, vacía `NOTIFICATIONS_FUNCTION_URL` y reinicia el bridge.

La Function URL usa `AuthType.NONE` para que el bridge docente pueda invocarla sin firma AWS. El handler rechaza peticiones sin `x-invoke-token`; aun así, la URL es pública y un tercero puede generar invocaciones con cargo. Usa tokens aleatorios, limita la duración del despliegue y destruye el stack después de clase. Los parámetros `NoEcho` evitan que CloudFormation muestre los tokens en sus outputs; usuarios con acceso a la configuración de Lambda pueden ver sus variables de entorno. Lambda y CloudWatch pueden generar cargos según la cuenta y el uso.

```sh
pnpm destroy
```

## Comportamiento y límites

Orders corre como proceso Node en `:3002`. Inventory v2 corre como contenedor en `:3005` por defecto; v1 queda retenido en `:3003`. Notifications ejecuta la lógica en Lambda cuando el bridge usa Function URL; en local invoca exactamente el mismo handler sin cuenta AWS. Los tres comparten los subjects NATS existentes.

El bridge usa NATS Core, con entrega como máximo una vez y sin persistencia ni reintento duradero. Si el handler falla, el bridge registra `event.handler_error`; el evento no se reproduce automáticamente. Este comportamiento basta para el recorrido de clase y no constituye entrega fiable de notificaciones.

Resend tiene un timeout de 5 segundos. Si rechaza el envío, falla la red o falta configuración, el handler registra `emailStatus=error` y `emailError=true` y responde 202. `sent` significa que Resend aceptó el envío, no que el inbox lo recibió. No hay reintento de correo ni rollback de la saga.
