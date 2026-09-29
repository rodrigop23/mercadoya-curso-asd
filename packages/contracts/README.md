# Contratos de Orders e Inventory

`@mercadoya/contracts` publica los subjects NATS, schemas Zod de eventos v1 y los puertos TypeScript que Inventory usa para reservar stock y consultar Catalog. Orders e Inventory importan estas definiciones; cada servicio conserva sus handlers, persistencia y transporte.

Orders publica `orders.placed` con `version: 1`. Inventory valida ese evento, llama a `InventoryPort.reserve` y publica `inventory.reserved` o `inventory.rejected`. Orders consume el resultado para actualizar el pedido. `CatalogStockContract` describe solo la consulta y el ajuste de stock que usa Inventory. El paquete no contiene tablas ni consultas Drizzle.

Los tres schemas de eventos conservan `buyerId: string | null` por compatibilidad v1. El publisher actual de Orders obtiene el ID de la sesión y emite un string. Una versión v2 puede añadirse aquí sin cambiar los subjects v1.

`reservationResponseV1Schema` conserva el JSON de lectura de reservas. `reservationResponseV2Schema` exige además `reservation.status: "reserved"`. Estos DTO son del API HTTP y no alteran los eventos NATS v1 ni sus subjects.

El [OpenAPI de Inventory](../../apps/inventory-service/openapi.yaml) describe el borde HTTP para health y lectura de reservas. La reserva se solicita por NATS, no por HTTP. No se creó un OpenAPI de Catalog; queda fuera de este laboratorio.
