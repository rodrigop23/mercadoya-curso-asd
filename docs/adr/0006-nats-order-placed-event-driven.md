# 6. Integración asíncrona con NATS y evento OrderPlaced

## Estado

Aceptada

## Contexto

Con varios módulos de dominio, un pedido no debe acoplarse directamente a Inventory ni a Notifications. La teoría de la sesión 4 presenta event-driven como desacoplamiento temporal y fan-out hacia varios procesadores.

Kafka sirve como referente para el material, pero es demasiado pesado para operar en este monorepo de curso. Se necesita un broker ligero que pueda levantarse con Docker y un plan B para las clases donde Docker o NATS no estén disponibles.

El hecho de negocio central de la demo es que se colocó un pedido.

## Decisión

Adoptamos NATS en Docker Compose junto a PostgreSQL.

- Orders persiste el pedido en estado `pending` y publica `orders.placed` con un payload versionado y validado con Zod: `orderId`, `productId`, `quantity`, `buyerId` y `occurredAt`.
- Inventory consume `orders.placed`, reserva stock y publica `inventory.reserved` o `inventory.rejected`.
- Orders consume el resultado de Inventory y actualiza el estado a `confirmed` o `rejected`.
- Notifications consume el pedido y su resultado mediante un sender stub.
- Catalog puede añadir una métrica ligera en una iteración futura.
- Los logs estructurados muestran publicaciones, consumidores y cambios de estado.
- `EVENT_BUS=inprocess` ejecuta los mismos handlers sin broker. Si NATS no conecta al inicio, la API cambia a in-process y lo deja registrado en logs.

No se implementan sagas con compensaciones elaboradas ni Outbox transaccional. Kafka solo se menciona como comparación pedagógica y no se implementa.

## Consecuencias

La demo hace visible el fan-out y permite mantener módulos desacoplados por eventos. NATS requiere operar un contenedor y el flujo tiene consistencia eventual: el pedido se crea como `pending` y puede terminar rechazado por stock. La API expone `GET /api/orders/:orderId` para consultar el estado final.

Como no hay Outbox transaccional, un fallo del proceso entre guardar y publicar puede dejar un pedido pendiente. Si en una siguiente etapa hace falta entrega confiable, se evaluará Outbox en otro ADR. El pipeline de cloud sigue aislado en ADR 0007.
