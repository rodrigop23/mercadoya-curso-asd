# MercadoYa timeline API

Hono en `:3001` conserva `GET /api/events`, `GET /api/events/health` y `POST /api/events/ingest`. Catalog y Media viven en [catalog-service](../catalog-service/README.md) en `:3007`. API no tiene módulos de dominio, cliente HTTP Identity, tablas, migraciones ni proxy de Catalog.

Kong publica health y protege la lectura de eventos con `identity-auth`. API verifica Bearer RS256 mediante JWKS también para llamadas directas. Notifications llama a ingest mediante `x-ingest-token`; Kong responde 404 para esa ruta interna. Los eventos permanecen en memoria y se pierden al reiniciar.

Compose inicia API. Para ejecutar en host, detén su contenedor y usa `pnpm --filter @mercadoya/api dev`, con `IDENTITY_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` y `NOTIFICATIONS_INGEST_TOKEN` configurados. Ajusta el upstream Kong a `http://host.docker.internal:3001`.
