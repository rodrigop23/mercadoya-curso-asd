# ADR 0015: Coordinar pedidos con saga por coreografía y compensación

## Estado

Aceptada en `v3-services`, tras los commits `0ddd69f` y `d2c8a55`.

## Contexto

Orders y Inventory ejecutan pasos distribuidos y ya intercambian eventos NATS. No existe una transacción distribuida ni 2PC entre el pedido, la reserva y el ajuste HTTP de Catalog. Faltaba un paso después de reservar y una compensación cuando el pago fallara. En V2 y antes del prompt 09, `inventory.reserved` bastaba para confirmar.

## Decisión

La saga usa coreografía con NATS. Cada consumidor reacciona al evento correspondiente, sin orquestador central. El pago es un simulador dentro del proceso Orders `:3002`, sin PSP ni bounded context Payments independiente.

1. Orders guarda el pedido `pending` y publica `orders.placed`. Solo Inventory v2 lo consume para reservar stock mediante Catalog.
2. Si Inventory publica `inventory.rejected`, Orders rechaza el pedido y Notifications prepara el correo de stock. No se simula pago.
3. Si Inventory publica `inventory.reserved`, el simulador en Orders publica `payment.succeeded` o `payment.failed`. Reservar no confirma.
4. Con `payment.succeeded`, Orders cambia a `confirmed` y Notifications prepara el correo de confirmación.
5. Con `payment.failed`, Orders cambia a `rejected`, Inventory ejecuta `release(orderId)` y Notifications prepara el correo de pago fallido. Estos consumidores trabajan en paralelo.
6. Inventory restaura el stock, elimina la reserva y publica `inventory.released`. Orders también consume este evento para registrar el rechazo si el pedido sigue `pending`. Los resultados solo actualizan pedidos `pending`; un estado terminal no se sobrescribe. El estado `rejected` y el correo pueden observarse antes de completar la compensación.

`PAYMENT_MODE` selecciona `succeed` o `fail`, con `succeed` por defecto. El override opcional `paymentMode` en `orders.placed` se propaga a `inventory.reserved` y tiene prioridad sobre la variable de entorno. Solo el CLI interno lo usa; el POST público no lo acepta.

La liberación usa un lock transaccional por pedido. Si ya no existe reserva, retorna sin ajustar stock ni publicar otra liberación. Así, fallos duplicados no reponen stock dos veces tras una liberación completada. Solo Inventory v2 consume NATS; v1 conserva lectura HTTP explícita y health; el alias sin versión usa ahora el contrato v2.

## Consecuencias

`pnpm demo:saga` comprueba pago exitoso, rechazo de stock, pago fallido y liberación ante fallos duplicados. Crea pedidos persistentes y el caso exitoso consume una unidad. La guía detalla la preparación y las variables; no requiere otro proceso de pagos.

La confirmación tiene una semántica distinta de V2 y del estado anterior al prompt 09. Notifications consume solo los tres desenlaces descritos en ADR 0011 y puede enviar con Resend o registrar un stub. Ni el correo ni la timeline controlan la saga.

NATS Core no persiste eventos ni reintenta su entrega. Guardar el pedido y publicar no es atómico y no hay outbox. El ajuste HTTP en Catalog tampoco pertenece a la transacción PostgreSQL de Inventory: el lock evita duplicados concurrentes, pero no resuelve fallos entre el ajuste, el commit y la publicación. La demo no garantiza recuperación durable de una compensación interrumpida.

## Referencias

- [Contratos de eventos](../../packages/contracts/src/index.ts).
- [Simulador de pago](../../apps/orders-service/src/payment/simulator.ts) y [suscripciones de Orders](../../apps/orders-service/src/index.ts).
- [Liberación de Inventory](../../apps/inventory-service/src/inventory/service.ts) y [publicación de inventory.released](../../apps/inventory-service/src/inventory/index.ts).
- [CLI de saga](../../apps/orders-service/src/demo-saga.ts) y [guía de ejecución](../../scripts/README.md).
- [ADR 0011 de Notifications](0011-notifications-lambda-bridge.md) y [secuencia canónica](../diagrams/seq-order-placed-fanout-v3.md).
