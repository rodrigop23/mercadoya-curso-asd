# ADR 0011: Invocar Notifications mediante un bridge NATS

## Estado

Aceptada en S5 (`v3-services`).

## Contexto

NATS entrega los eventos del pedido, mientras que el código de Notifications se presenta como handler AWS Lambda. En local hace falta unir ambos sin desplegar AWS.

## Decisión

El bridge Node escucha `orders.placed`, `inventory.reserved` e `inventory.rejected` en NATS y expone health en `:3004`. Invoca el handler local o, si existe `NOTIFICATIONS_FUNCTION_URL`, la Function URL. Envía `x-invoke-token` en ambos modos. El handler valida el evento, construye una notificación stub y la envía a `POST /api/events/ingest` con otro secreto, `x-ingest-token`. El API guarda los eventos recientes en memoria para la timeline.

## Consecuencias

El bridge es un proceso local; el handler es la unidad desplegable como Lambda. Notifications no manda correo. El buffer de timeline se pierde al reiniciar el API. NATS básico y este bridge no dan reintentos durables de notificaciones.

## Referencias

- [Bridge](../../apps/notifications-lambda/src/bridge.ts), [handler](../../apps/notifications-lambda/src/handler.ts), [ingest](../../apps/api/src/events/routes.ts) y [guía de Notifications](../../apps/notifications-lambda/README.md).
- [Secuencia de compra S5](../diagrams/seq-order-placed-fanout-v3.md).
