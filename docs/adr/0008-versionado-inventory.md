# ADR 0008: Versionar la API HTTP y el despliegue de Inventory

## Estado

Aceptada en S5 (`v3-services`).

## Contexto

La lectura de reservas necesita mostrar un contrato HTTP nuevo mientras la versión anterior sigue disponible. La clase también compara dos despliegues del mismo servicio. Esas dos versiones tienen propósitos distintos.

## Decisión

La versión de API identifica el contrato HTTP. Inventory ofrece `/api/inventory/v1/*` y `/api/inventory/v2/*` en paralelo. La respuesta v2 de reservas exige `reservation.status: "reserved"`; v1 conserva el JSON anterior. Las rutas sin prefijo de versión son alias v2 del contrato de aplicación por defecto. Las operaciones v1 explícitas están marcadas como obsoletas en OpenAPI.

La versión de servicio identifica el despliegue. Compose inicia dos contenedores de la misma imagen con `SERVICE_VERSION=v1` y `v2`; el gateway los dirige a puertos distintos. El header `X-Service-Version` y la ruta de health permiten comprobar qué contenedor respondió.

El gateway envía `/api/inventory/v1/*` a `inventory-v1` en `:3003` y `/api/inventory/v2/*` a `inventory-v2` en `:3005`. Ambos contenedores escuchan en `3003` internamente; Compose publica el segundo en `3005`.

Solo el contenedor v2 se suscribe a `orders.placed` y `payment.failed`. Ambos leen la misma tabla de reservas. Así el despliegue paralelo no duplica el ajuste de stock. Los subjects y esquemas NATS v1 no cambian.

## Consecuencias

La versión HTTP cambia el JSON de lectura; `SERVICE_VERSION` identifica la instancia que lo sirve. Los eventos NATS siguen con `version: 1` en ambos casos. El alias sin versión cambia a v2. Los clientes que esperaban v1 deben migrar al contrato v2 o usar v1 explícitamente durante la compatibilidad.

## Seguimiento

El cutover del prompt 03 fija v2 como default y propietario único de reserva y compensación. No hay fecha acordada para retirar el contrato HTTP v1. Actualizar ambos runtimes evita que un proceso v1 antiguo siga consumiendo junto con v2. Pausar creación de pedidos, detener ambos Inventory y reconstruirlos antes de reanudar; Core NATS no retiene eventos durante la pausa.

## Referencias

- [Rutas HTTP y DTO](../../apps/inventory-service/src/inventory/routes.ts), [arranque y suscripción NATS](../../apps/inventory-service/src/index.ts), [OpenAPI](../../apps/inventory-service/openapi.yaml) y [Compose](../../docker-compose.yml).
- [Gateway](../../infra/kong/kong.yml), [contratos compartidos](../../packages/contracts/src/index.ts) y [guía de Inventory](../../apps/inventory-service/README.md).

La deprecación de v1 adopta [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html): `Deprecation` contiene la fecha de deprecación y `Link` señala la ruta v2 equivalente mediante `successor-version`. No se anuncia `Sunset`. Las operaciones v1 mantienen su comportamiento y `deprecated: true` conforme a [OpenAPI Operation](https://spec.openapis.org/oas/latest.html#operation-object). Se verificaron también [routing Hono](https://hono.dev/docs/api/routing) y [servicios Compose](https://docs.docker.com/reference/compose-file/services/).
