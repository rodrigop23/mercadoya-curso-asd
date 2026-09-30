# ADR 0011: Invocar Notifications mediante un bridge NATS

## Estado

Aceptada en S5 (`v3-services`). Actualizada tras la saga y la integración de Resend.

## Contexto

NATS entrega los eventos del pedido, mientras que Notifications ejecuta un handler AWS Lambda. En local hace falta unir ambos sin desplegar AWS. Tras incorporar el pago simulado, la notificación depende del desenlace, no de la creación del pedido ni de la reserva.

## Decisión

El bridge Node escucha solo `payment.succeeded`, `payment.failed` e `inventory.rejected` en NATS y expone health en `:3004`. Invoca el handler local en su proceso o, si existe `NOTIFICATIONS_FUNCTION_URL`, la Function URL. Envía `x-invoke-token` en ambos modos. El handler valida el evento con `@mercadoya/contracts` y renderiza HTML y texto mediante React Email.

| Subject              | Template                     | Asunto                         |
| -------------------- | ---------------------------- | ------------------------------ |
| `payment.succeeded`  | `order-confirmed.tsx`        | Pedido confirmado              |
| `inventory.rejected` | `order-rejected-stock.tsx`   | No pudimos completar tu pedido |
| `payment.failed`     | `order-rejected-payment.tsx` | El pago no se completó         |

Resend usa `RESEND_API_KEY` y `RESEND_FROM`. Todos los pedidos usan `DEMO_NOTIFY_EMAIL` como destinatario de clase, incluso con `buyerId`; no hay lookup de email en Identity. `EMAIL_MODE` vacío elige Resend si hay key y stub si no la hay. `EMAIL_MODE=stub` fuerza la simulación. Sin destinatario se registra un stub; forzar Resend sin key o remitente produce error de correo.

Después del intento, el handler registra `notification.stub` o `notification.email` en logs. `emailStatus` distingue `stub`, `sent` y `error`. El bridge no consume `orders.placed`, `inventory.reserved` ni `inventory.released`.

## Consecuencias

El bridge es un proceso local; el handler es la unidad desplegable como Lambda. Una reserva no genera correo de confirmación. El correo de pago fallido sale por `payment.failed`, en paralelo a la compensación; no certifica que el stock ya se haya restaurado.

`sent` indica que Resend aceptó el envío, no la entrega al inbox. Un error de correo se registra sin revertir la saga ni reintentar el envío. Resend recibe una clave de idempotencia por subject y pedido; los logs pueden registrar duplicados. NATS Core no ofrece reproducción ni reintentos durables.

## Referencias

- [Bridge](../../apps/notifications-lambda/src/bridge.ts), [handler](../../apps/notifications-lambda/src/handler.ts), [templates](../../apps/notifications-lambda/src/emails/).
- [Guía de Notifications y configuración Resend](../../apps/notifications-lambda/README.md).
- [Secuencia canónica de saga](../diagrams/seq-order-placed-fanout-v4.md) y [ADR 0015](0015-saga-coreografia-compensacion.md).
