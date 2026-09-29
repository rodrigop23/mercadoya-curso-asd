# ADR 0012: Usar el API como gateway y BFF

## Estado

Aceptada en S5 (`v3-services`).

## Contexto

El navegador necesita una dirección de API para módulos locales y servicios extraídos. Orders e Inventory también necesitan comprobar la sesión de usuario; Inventory y Notifications tienen llamadas internas distintas.

## Decisión

El proceso Hono en `:3001` conserva Identity, Catalog, Media y las rutas de eventos. Proxifica Orders `:3002`, Inventory v1 `:3003`, Inventory v2 `:3005` y el health de Notifications bridge `:3004`. Web y MF llaman a `:3001` con cookie de sesión; CORS admite `localhost:5173` y `localhost:5174` con credenciales. Orders e Inventory consultan `GET /api/me` con la cookie recibida. Inventory usa `x-catalog-internal-token` para Catalog interno. Bridge y handler usan secretos separados para invocación e ingest.

## Consecuencias

El gateway concentra la dirección pública de API y devuelve `502` cuando un upstream no responde. La cookie representa al usuario; los tokens internos autorizan llamadas entre procesos y no sustituyen la comprobación de rol. La demo no incluye service mesh ni JWT/JWKS entre servicios.

## Referencias

- [Composición y proxies](../../apps/api/src/api-layer.ts), [Identity](../../apps/api/src/modules/identity/routes.ts), [Catalog](../../apps/api/src/modules/catalog/routes.ts), [ingest](../../apps/api/src/events/routes.ts) y [README raíz](../../README.md).
- [Vista de componentes S5](../diagrams/c4-3-components-v3.md).
