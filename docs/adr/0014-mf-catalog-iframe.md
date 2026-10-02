# ADR 0014: Montar el catálogo admin mediante iframe

Documento histórico de una etapa anterior. No describe el despliegue actual ni debe usarse para iniciarlo. Consulta el [README actual](../../README.md) y el ADR 0020 sobre el retiro de la experiencia de eventos.

> Decisión histórica, reemplazada por [ADR 0019](0019-catalog-module-federation.md).

## Estado

Aceptada en S5 (`v3-services`).

## Contexto

La clase necesita una pieza de administración desplegable por separado. El host ya sirve el catálogo buyer y controla navegación y sesión.

## Decisión

`apps/web` en `:5173` mantiene `/catalog`, la shell y el guard de `/admin/products`. Esa ruta monta `apps/mf-catalog` en `:5174` mediante iframe. El MF ofrece CRUD admin y llama a Catalog en `:3001` con cookie. El remoto envía su altura con `postMessage` y el host comprueba el origen. El MF consulta `GET /api/me`; el API vuelve a exigir rol admin en escrituras. CORS y los orígenes confiables admiten ambos puertos.

## Consecuencias

Host y MF pueden servir documentos y estilos separados. El iframe añade un documento y coordinación de altura. Se eligió frente a Module Federation o import maps para esta demo; no hay carga de módulos remotos en el host. Buyer sigue dentro del host: buyer y admin no son dos microfrontends.

## Referencias

- [Ruta del host](../../apps/web/src/routes/admin.products.tsx), [entrada del MF](../../apps/mf-catalog/src/main.tsx), [cliente Catalog](../../apps/mf-catalog/src/lib/products.ts), [guía del MF](../../apps/mf-catalog/README.md) y [secuencia admin](../diagrams/seq-admin-mf-catalog.md).
