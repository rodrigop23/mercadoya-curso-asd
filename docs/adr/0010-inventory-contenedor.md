# ADR 0010: Ejecutar Inventory en contenedores

Documento histórico de una etapa anterior. No describe el despliegue actual ni debe usarse para iniciarlo. Consulta el [README actual](../../README.md) y el ADR 0020 sobre el retiro de la experiencia de eventos.

## Estado

Aceptada en S5 (`v3-services`).

## Contexto

Inventory deja el proceso API. Debe atender consultas HTTP y reservar stock al recibir pedidos, sin acceder directamente a las tablas de Catalog.

## Decisión

Un Dockerfile construye Inventory. Compose ejecuta `inventory-v1` en `:3003` e `inventory-v2` en `:3005` del host. Los dos usan la misma imagen y base de reservas. Solo v2 se suscribe a `orders.placed` para reservar y a `payment.failed` para compensar; v1 conserva HTTP explícito y health. v2 publica `inventory.reserved` o `inventory.rejected` tras intentar reservar. Ante un pago fallido, `release(orderId)` restaura el stock en Catalog, elimina la reserva y publica `inventory.released` si había una reserva. El lock por pedido serializa liberaciones duplicadas; sin reserva, no restaura stock ni publica otra liberación. Inventory consulta y ajusta stock mediante rutas internas HTTP de Catalog en el API, autenticadas con `x-catalog-internal-token`. Para lecturas protegidas, consulta la sesión de usuario en `GET /api/me`.

## Consecuencias

El límite entre Inventory y Catalog se comprueba mediante HTTP y un secreto compartido. La demo requiere Compose y conectividad del contenedor hacia `host.docker.internal:3001`. Compartir PostgreSQL simplifica la clase, pero no da aislamiento de datos entre servicios. La distinción entre despliegue v1/v2 y contrato HTTP v1/v2 consta en ADR 0008.

## Referencias

- [Dockerfile](../../apps/inventory-service/Dockerfile), [Compose](../../docker-compose.yml), [arranque](../../apps/inventory-service/src/index.ts), [cliente Catalog](../../apps/inventory-service/src/catalog/http.ts) y [guía de Inventory](../../apps/inventory-service/README.md).
- [ADR 0008](0008-versionado-inventory.md) y [ADR 0015](0015-saga-coreografia-compensacion.md).
- [Liberación de reservas](../../apps/inventory-service/src/inventory/service.ts) y [consumidores y publicación](../../apps/inventory-service/src/inventory/index.ts).
