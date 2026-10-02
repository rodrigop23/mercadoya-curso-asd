# ADR 0010: Inventory como contenedor

## Estado

Aceptada en S5 y actualizada por el prompt 11. El despliegue dual permanece en la rama `v3-services`.

## Decisión

El Dockerfile construye Inventory y Compose ejecuta un contenedor `inventory` con puerto `3003:3003`. Kong usa el upstream `http://inventory:3003`. El proceso sirve health y lectura de reservas con el contrato vigente y verifica JWT mediante JWKS de Identity.

Inventory consume `orders.placed` para reservar y `payment.failed` para compensar. Consulta y ajusta stock mediante HTTP interno de Catalog, autenticado con `x-catalog-internal-token`. Publica `inventory.reserved` o `inventory.rejected` tras reservar. Ante un pago fallido, `release(orderId)` restaura el stock, elimina la reserva y publica `inventory.released` si había una reserva. El lock por pedido serializa liberaciones duplicadas.

## Consecuencias

La demo requiere Compose y conectividad hacia Catalog, Identity, PostgreSQL y NATS. Compartir PostgreSQL simplifica la clase, pero no proporciona aislamiento de datos entre servicios. Health comprueba que el proceso responde. El contrato y el cutover están en [ADR 0008](0008-versionado-inventory.md) y [Inventory](../../apps/inventory-service/README.md).
