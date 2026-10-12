# Diagramas Archify

[Arquitectura frontend, Kong y NATS](arquitectura-kong-nats/arquitectura.html) muestra el frontend, el microfrontend federado, las rutas de Kong y los servicios conectados a NATS en el runtime actual. Incluye [fuente editable](arquitectura-kong-nats/arquitectura.architecture.json) y [recibo de validación](arquitectura-kong-nats/arquitectura.receipt.json).

Los HTML de `flujo-compra-v1/` y `flujo-compra-v2/` documentan demos anteriores. Su topología no representa el runtime actual de `v3-services`: Orders, Inventory y Notifications ya corren fuera del proceso API. `flujo-pipeline/` muestra el pipeline local de imágenes, pero su UI admin también precede al MF iframe.

Para la arquitectura actual consulta [C4 contenedores actual](../c4-2-containers-v4.md), [compra actual](../seq-order-placed-fanout-v4.md) y [admin MF](../seq-admin-mf-catalog-v4.md). Se conservan los HTML y JSON para comparar las etapas del curso.
