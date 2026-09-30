# ADR 0016: Generar specs HTTP desde contracts

## Estado

Aceptada. Amplía ADR 0013 y mantiene el despliegue y las suscripciones de Inventory descritos en ADR 0008.

## Decisión

`@mercadoya/contracts` empieza en `1.0.0` y centraliza los validadores HTTP de Orders, Identity y Catalog además de Inventory y los eventos de saga existentes. Los módulos importan esos validadores. El generador del paquete combina schemas Zod y metadatos de operaciones para producir specs OpenAPI 3.1.0 versionadas en Git y JSON Schemas de eventos. Zod 4.6.5, yaml 2.8.1 y Redocly CLI 2.0.0 quedan fijados. CI exige specs reproducibles, válidas y contracts que compilen y pasen parse tests.

Orders documenta creación autenticada por cookie y consulta pública. Identity fija signup/signin email, logout, sesión del proveedor y `/api/me`; el resto del catch-all depende de Better Auth. Catalog documenta multipart público y el borde interno de stock con secreto compartido. Media documenta health, archivos estáticos y su entrada a través de Catalog. Los servers directos de Inventory se limitan a los paths de su versión. El alias y el consumidor NATS siguen en v1.

## Consecuencias

El owner de cada módulo revisa schemas, metadatos y handlers juntos. Un breaking change exige major del paquete, versión de spec actualizada, contrato paralelo y deprecación/migración explícita con revisión de consumidores. Los subjects y correlación de saga v1 no cambian. El generador no importa persistencia y no arranca apps. No se extraen Identity/Catalog, no se cambia cookie por JWT, no se diseña Polar y no se introduce Kong.

Los refinements posteriores a transforms de multipart requieren descripciones y tests de parse porque JSON Schema no expresa toda su conducta. La comprobación reproducible verifica specs contra los metadatos; la revisión del owner verifica esos metadatos contra las rutas reales. No hay detección automática completa de breaking changes ni prueba de integración de transporte/DB en este paso.

## Referencias

[Ownership, comandos y política de versionado](../../packages/contracts/README.md), [Inventory](../../apps/inventory-service/openapi.yaml), [Orders](../../apps/orders-service/openapi.yaml), [Identity](../../apps/api/openapi/identity.yaml), [Catalog](../../apps/api/openapi/catalog.yaml) y [Media](../../apps/api/openapi/media.yaml).
