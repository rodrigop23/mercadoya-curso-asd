# ADR 0013: Compartir contratos de eventos y documentar Inventory con OpenAPI

## Estado

Aceptada en S5 (`v3-services`).

## Contexto

Orders e Inventory intercambian eventos NATS. Inventory también expone lectura HTTP de reservas, cuyo contrato v2 cambia sin modificar el evento.

## Decisión

`@mercadoya/contracts` contiene los subjects, esquemas Zod de eventos con `version: 1`, puertos TypeScript de Inventory y Catalog, y DTO de lectura HTTP v1/v2. Los subjects son `orders.placed`, `inventory.reserved`, `inventory.rejected`, `inventory.released`, `payment.succeeded` y `payment.failed`. Orders, Inventory y Notifications validan sus eventos con estos esquemas. `orders.placed` e `inventory.reserved` admiten `paymentMode` opcional para el CLI interno; el POST público no acepta ese override. Los eventos de fallo incluyen `reason`. El simulador de Orders produce el desenlace del pago y solo Inventory v1 procesa la reserva y la compensación. `apps/inventory-service/openapi.yaml` documenta health y lectura de reservas, incluidos los alias sin versión marcados como obsoletos. La solicitud de reserva entra por NATS, no por HTTP.

## Consecuencias

Un cambio de esquema de evento exige coordinar productores y consumidores. Versionar el JSON HTTP no cambia los subjects NATS. El paquete no comparte tablas Drizzle. La saga y sus transiciones constan en [ADR 0015](0015-saga-coreografia-compensacion.md). OpenAPI Catalog queda fuera de este laboratorio.

## Referencias

- [Paquete de contratos](../../packages/contracts/src/index.ts), [README de contratos](../../packages/contracts/README.md), [OpenAPI Inventory](../../apps/inventory-service/openapi.yaml) y [ADR 0008](0008-versionado-inventory.md).
