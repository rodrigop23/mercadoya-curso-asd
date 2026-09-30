# 6. Pedidos por eventos con NATS

Documento histórico de una etapa anterior. No describe el despliegue actual ni debe usarse para iniciarlo. Consulta el [README actual](../../README.md) y el ADR 0020 sobre el retiro de la experiencia de eventos.

## Estado

Aceptada

## Contexto

Orders necesita crear pedidos sin invocar directamente a Inventory y Notifications. La sesión 4 usa el evento de negocio `orders.placed` para distribuir ese trabajo entre consumidores independientes.

El curso requiere un broker que pueda iniciarse junto a PostgreSQL con Docker Compose. La API también debe poder mostrar el flujo si NATS no está disponible al iniciar.

## Decisión

Orders guarda cada pedido con estado `pending` y publica `orders.placed` con un payload versionado y validado con Zod. La versión 1 incluye `orderId`, `productId`, `quantity`, `buyerId` y `occurredAt`.

NATS entrega `orders.placed` a dos consumidores:

- Inventory consulta y ajusta el stock mediante `CatalogContract`, y publica `inventory.reserved` o `inventory.rejected`.
- Notifications registra que recibió el pedido mediante su sender stub.

Orders consume el resultado de Inventory y cambia el pedido a `confirmed` o `rejected`. Notifications consume también el resultado y registra la confirmación o el rechazo. Catalog no se suscribe a `orders.placed`.

El frontend muestra el estado en `/orders/$orderId` y el timeline en `/events`. La API sirve los eventos recientes mediante `GET /api/events`; la consulta se filtra por `orderId` en el detalle del pedido. Notifications escribe logs de demo y no envía correo.

NATS corre localmente mediante Docker Compose. `EVENT_BUS=inprocess` selecciona el transporte en memoria. Si la API no logra conectarse a NATS durante el arranque, usa ese transporte como fallback. Kafka solo se menciona como comparación pedagógica; no forma parte del sistema.

## Consecuencias

El pedido empieza en `pending` y cambia cuando Inventory publica el resultado, por lo que el flujo tiene consistencia eventual. El código no implementa una Outbox transaccional ni procesamiento durable de mensajes. Si el proceso falla después de guardar el pedido y antes de publicar el evento, el pedido puede quedar pendiente.

La demo permite ver el fan-out sin añadir consumidores directos a Orders. NATS requiere un contenedor local; el transporte en memoria cubre la sesión si el broker no está disponible.

## Seguimiento

Evaluar una Outbox en una decisión futura si el flujo requiere entrega confiable. La demo cloud continúa aislada según ADR 0007.
