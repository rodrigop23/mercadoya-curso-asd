# ADR 0008: Versionar la API HTTP y el despliegue de Inventory

## Estado

Borrador para la discusión de la sesión 9.

## Decisión

La versión de API identifica el contrato HTTP. Inventory ofrece `/api/inventory/v1/*` y `/api/inventory/v2/*` en paralelo. La respuesta v2 de reservas exige `reservation.status: "reserved"`; v1 conserva el JSON anterior. Las rutas sin prefijo de versión son alias v1 y están marcadas como obsoletas en OpenAPI.

La versión de servicio identifica el despliegue. Compose inicia dos contenedores de la misma imagen con `SERVICE_VERSION=v1` y `v2`; el gateway los dirige a puertos distintos. El header `X-Service-Version` y la ruta de health permiten comprobar qué contenedor respondió.

Solo el contenedor v1 se suscribe a `orders.placed`. Ambos leen la misma tabla de reservas. Así el despliegue paralelo no duplica el ajuste de stock. Los subjects y esquemas NATS v1 no cambian.

## Pendiente

La sesión 9 puede decidir durante cuánto tiempo mantener el alias y el contrato HTTP v1, y si el consumo de eventos debe migrar a otro despliegue.
