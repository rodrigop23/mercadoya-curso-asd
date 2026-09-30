# Catalog y Media

Proceso Hono en `:3007`, detrás de Kong `:8000`. Catalog posee el CRUD y stock; Media procesa imágenes en el mismo proceso. [ADR 0018](../../docs/adr/0018-catalog-media-kong.md) explica la decisión y la base compartida.

Desde la raíz, configura `.env` siguiendo `.env.example` y ejecuta `pnpm demo:infra`. Después `pnpm dev` inicia web `:5173` y MF admin `:5174`. Ambos llaman a Kong con sesión cookie; Kong la convierte en JWT. Catalog verifica RS256/JWKS y exige admin en POST, PUT y DELETE. Directo al servicio, una cookie sola devuelve 401. GET de productos, health de Catalog/Media y `/uploads/*` son públicos.

Inventory usa `CATALOG_URL=http://catalog:3007` en Compose y `http://localhost:3007` en host. Conserva `x-catalog-internal-token`, `/api/internal/catalog/products/:id/stock` y `/api/internal/catalog/products/:id/adjust-stock`. Kong responde 404 para stock interno; la URL de Kong no sirve como `CATALOG_URL`.

La imagen llega en multipart del CRUD, sin endpoint de upload separado. Acepta JPEG, PNG y WebP hasta 2 MiB; verifica firma y produce full/thumb con Sharp. Kong y Hono limitan el formulario total a 3 MiB, incluido el overhead multipart, y devuelven 413 si excede el límite. CORS admite solo `http://localhost:5173` y `http://localhost:5174` con credenciales. Identity rechaza mutaciones con cookie desde otros orígenes.

Compose monta el directorio `apps/catalog-service/uploads` en `/app/uploads` de Catalog con `UPLOADS_DIR=/app/uploads`. Los paths de PostgreSQL no cambian. `demo:infra` crea el directorio y usa UID/GID del host. En host, el directorio por defecto es `apps/catalog-service/uploads`; `UPLOADS_DIR` permite elegir otra ruta absoluta. Al actualizar una instalación anterior, copia su carpeta de imágenes completa a este directorio antes de iniciar Catalog. Los paths relativos de PostgreSQL se conservan. No se necesita S3.

```sh
pnpm --filter @mercadoya/catalog-service db:migrate
pnpm --filter @mercadoya/identity-service db:migrate
```

El SQL y journal históricos se trasladaron sin cambios desde API. La base PostgreSQL y el journal `drizzle.__drizzle_migrations` siguen compartidos; no hay migración de filas ni de archivos. El baseline contiene tablas históricas de Identity, Orders, Inventory y Notifications; sus consultas pertenecen a esos servicios. Identity aplica después su migración propia. Evita `db:push` y generación automática sobre el agregado histórico. `db:reset --yes` elimina public y drizzle y requiere volver a aplicar Identity.

Para desarrollo en host, detén el contenedor Catalog, exporta las variables de `.env`, configura `UPLOADS_DIR` y ejecuta `pnpm --filter @mercadoya/catalog-service dev`. Cambia el upstream Kong a `http://host.docker.internal:3007`. OpenAPI canónico vive en `openapi/catalog.yaml` y `openapi/media.yaml`; se genera con `pnpm openapi:generate`.
