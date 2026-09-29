# 5. Módulos service-based dentro del monolito

## Estado

Aceptada

## Contexto

ADR 0001 mantiene un proceso de backend y una base de datos. ADR 0003 delimitó Identity y Catalog mediante contratos. La sesión 4 amplía el recorrido con publicación de imágenes, pedidos, reserva de stock y notificaciones.

Identity y Catalog no deben absorber todas esas responsabilidades. La API también necesita un punto único para montar las rutas, mientras cada módulo conserva sus contratos y sus tablas.

## Decisión

MercadoYa sigue como un monolito modular. Un solo proceso Node/Hono compone seis módulos de dominio:

- `identity`, para autenticación y roles.
- `catalog`, para productos y stock expuesto por contrato.
- `media`, para procesar imágenes.
- `orders`, para crear pedidos y mantener su estado.
- `inventory`, para reservar stock.
- `notifications`, para registrar notificaciones mediante un stub.

`apps/api/src/api-layer.ts` compone los módulos y monta sus rutas en una sola aplicación Hono. Identity y Catalog conservan las rutas de V1. Orders, Media, Inventory y Notifications exponen sus rutas bajo `/api/orders`, `/api/media`, `/api/inventory` y `/api/notifications`. La creación de producto llega a `/api/products`; Catalog llama a Media mediante `MediaContract` para procesar la imagen.

Los módulos colaboran mediante contratos o eventos. Catalog usa `IdentityContract` para autorizar al admin. Inventory llama a `CatalogContract` para consultar y ajustar el stock; no importa tablas de Catalog. Orders y Notifications participan en el flujo de pedidos mediante eventos, no mediante imports entre sus servicios.

La aplicación usa una sola base PostgreSQL y un solo cliente Drizzle. Cada módulo mantiene su archivo `schema.ts`; `apps/api/src/db/schema.ts` reúne esos esquemas para el cliente compartido. Las tablas nuevas usan nombres con prefijo de módulo, como `orders_order` e `inventory_reservations`. Identity y Catalog conservan nombres existentes como `user`, `session` y `product`. Esto es propiedad lógica de tablas, no separación en bases ni esquemas PostgreSQL.

## Consecuencias

Los módulos tienen límites internos claros sin sumar procesos, despliegues o bases de datos. La base compartida sigue requiriendo revisión para impedir consultas directas a tablas de otro módulo. Inventory accede al stock mediante el contrato de Catalog.

Service-based describe la organización de capacidades detrás de una API. No convierte a MercadoYa en un sistema de microservicios.

## Seguimiento

La comunicación asíncrona de Orders con Inventory y Notifications está definida en ADR 0006.
