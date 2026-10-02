# ADR 0012: Usar el API como gateway y BFF

Documento histórico de una etapa anterior. No describe el despliegue actual ni debe usarse para iniciarlo. Consulta el [README actual](../../README.md) y el ADR 0020 sobre el retiro de la experiencia de eventos.

## Estado

Reemplazada por [ADR 0017: Identity propio y Kong OSS](0017-identity-kong-jwks.md). El contenido siguiente conserva la decisión histórica de S5.

## Contexto

El navegador necesita una dirección de API para módulos locales y servicios extraídos. Orders e Inventory también necesitan comprobar la sesión de usuario; Inventory y Notifications tienen llamadas internas distintas.

## Decisión

La topología histórica del gateway Hono en `:3001` permanece en la rama `v3-services`. El despliegue actual usa Kong `:8000`, Identity propio y un único Inventory `:3003`, según [ADR 0017](0017-identity-kong-jwks.md) y [ADR 0008](0008-versionado-inventory.md). Web y MF llaman a Kong con cookie de sesión; CORS admite `localhost:5173` y `localhost:5174` con credenciales. Kong valida la sesión y reenvía JWT; Orders e Inventory verifican firma y claims mediante JWKS. Inventory usa `x-catalog-internal-token` para Catalog interno. Bridge y handler usan un secreto separado para invocación.

## Consecuencias

El gateway concentra la dirección pública de API y devuelve `502` cuando un upstream no responde. La cookie representa al usuario; los tokens internos autorizan llamadas entre procesos y no sustituyen la comprobación de rol. Kong queda fuera del laboratorio y de Compose; el entrypoint es este BFF Hono en `:3001`. La demo no incluye service mesh ni JWT/JWKS entre servicios.

## Referencias

- [Composición y proxies](../../apps/api/src/api-layer.ts), [Identity](../../apps/api/src/modules/identity/routes.ts), [Catalog](../../apps/api/src/modules/catalog/routes.ts), [ingest](../../apps/api/src/events/routes.ts) y [README raíz](../../README.md).
- [Vista de componentes S5](../diagrams/c4-3-components-v3.md).
