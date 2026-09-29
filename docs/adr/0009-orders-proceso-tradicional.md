# ADR 0009: Ejecutar Orders como servicio tradicional

## Estado

Aceptada en S5 (`v3-services`).

## Contexto

En V2, Orders era un módulo del proceso API. S5 necesita mostrar la extracción de un servicio sin exigir contenedor para cada proceso.

## Decisión

Orders corre como proceso Node y Hono en `:3002`. El gateway en `:3001` proxifica `/api/orders/*` sin mover Identity ni Catalog. Orders valida la sesión de usuario mediante `GET /api/me` en el API, guarda el pedido `pending` en PostgreSQL y publica `orders.placed` en NATS. Consume `inventory.reserved` o `inventory.rejected` y cambia el estado a `confirmed` o `rejected`.

## Consecuencias

El navegador usa un único origen de API. Orders tiene arranque y fallo propios, aunque comparte la base de la demo. Publicar el evento después de guardar el pedido deja una ventana de fallo; no hay outbox ni entrega durable. La guía compara este proceso tradicional con Inventory en contenedor (ADR 0010).

## Referencias

- [Arranque de Orders](../../apps/orders-service/src/index.ts), [servicio](../../apps/orders-service/src/orders/service.ts), [proxy del gateway](../../apps/api/src/api-layer.ts) y [guía de Orders](../../apps/orders-service/README.md).
- [ADRs 0006](0006-nats-order-placed-event-driven.md) y [0010](0010-inventory-contenedor.md).
