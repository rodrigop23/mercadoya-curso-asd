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

## Sincronización con Polar

Con `PAYMENT_PROVIDER=polar`, Catalog sincroniza automáticamente los productos con el SDK oficial, API `2026-04`. Comparte `POLAR_ACCESS_TOKEN` y `POLAR_SERVER` con Orders. Usa una organización dedicada a MercadoYa y un token con `products:write`, `organizations:write` y `checkouts:read/write`. El worker establece `default_presentment_currency=pen` antes de crear productos, porque Polar requiere un precio en la moneda predeterminada de la organización. `PAYMENT_PROVIDER=simulator` desactiva las llamadas a Polar, pero conserva los cambios pendientes para activarlo después.

La misma transacción del CRUD guarda una proyección en `catalog_polar_product`. El worker crea o actualiza título, descripción y precio fijo de compra única; DELETE conserva un registro pendiente y archiva el producto remoto. Imágenes y stock siguen en sus módulos actuales. El título local conserva hasta 160 caracteres; el nombre de Polar se adapta al rango de 3 a 64 caracteres. El identificador local queda en `metadata.mercadoya_product_id`. Los precios nuevos usan PEN y céntimos de sol: S/ 12.34 equivale a 1234. Se permiten S/ 2.00 a S/ 999,999.99 y se aplican impuestos exclusivos. Los productos históricos fuera del rango se deben editar antes de comprar.

La relación con el UUID Polar se guarda por entorno en PostgreSQL; no se configura un JSON de productos. Al iniciar, el worker incorpora los productos existentes y detecta productos locales eliminados. Actualizar precio o texto deja una versión pendiente; cambios de stock o imagen no crean precios remotos adicionales. El worker mantiene un advisory lock entre réplicas y aplica la última versión después de una edición concurrente. Al cambiar de sandbox a producción se crea una relación independiente. Los cambios locales también dejan pendientes los entornos previamente relacionados.

Orders consulta `GET /api/internal/catalog/products/:id/billing` con `x-catalog-internal-token` usando el origen directo de Catalog. Devuelve 200 con `status: ready`, UUID Polar y precio PEN; 202 pendiente; 409 fallida; 404 inexistente. Usa `Cache-Control: no-store`. Kong no expone esta ruta. Orders guarda el precio al crear el pedido y no reserva si el producto todavía no está disponible para pagos.

Un token de organización ya determina dónde crear el producto. El POST omite `organization_id`; enviarlo con un OAT provoca HTTP 422 con validación `organization_token`. El GET de búsqueda sí filtra por la organización y metadata.

Los fallos temporales de red, HTTP 408, 429 y 5xx tienen hasta cinco intentos por versión del producto. Entre intentos esperan 30, 60, 120 y 240 segundos; un 429 respeta `Retry-After` hasta una hora si exige más espera. El contador se guarda antes de llamar a Polar y sobrevive al reinicio. Un 401, 403, 422 u otro rechazo permanente se detiene inmediatamente. Al detenerse, `next_attempt_at` queda NULL y el producto devuelve billing `failed`. Los logs registran product ID, entorno, código, operación, estado HTTP, número de intento y próxima fecha, sin cuerpos ni secretos del SDK. No hay reintentos infinitos para un producto detenido.

`creating` representa un POST potencialmente completado. El worker busca por metadata antes de crear y recupera respuestas perdidas tras reiniciar. Si la consulta no encuentra el producto, conserva `creating` sin emitir otro POST, también al agotar intentos. Reactivar una operación incierta solo reanuda las consultas; no descarta esa protección. No borres el mapping ni cambies `creating` a `queued` sin comprobar en Polar que el POST anterior no creó el producto.

Después de corregir permisos en Polar, actualiza `POLAR_ACCESS_TOKEN` en `.env` y recrea Catalog y Orders para cargarlo. Para errores de payload, aplica la corrección antes de reactivar. El comando siguiente reanuda los registros detenidos del entorno `POLAR_SERVER` conservando su UUID remoto y el estado de creación incierta. Puede recibir un UUID local para reanudar un solo producto. Una edición de título, descripción o precio también empieza un nuevo presupuesto de intentos; cambiar stock o imagen no lo reinicia.

```sh
pnpm --filter @mercadoya/catalog-service build
pnpm --filter @mercadoya/catalog-service polar:retry
# Para un solo producto:
pnpm --filter @mercadoya/catalog-service polar:retry <product-id>
# Desde un contenedor que ya incluye el cambio:
docker compose exec -T catalog node scripts/retry-polar-products.mjs
```

Para revisar operaciones pendientes sin credenciales ni payloads de pago:

```sql
SELECT product_id, server, state, version, synced_version, error_code,
       attempt_count, next_attempt_at
FROM catalog_polar_product WHERE state <> 'synced';
```

Aplica `pnpm --filter @mercadoya/catalog-service db:migrate` y `pnpm --filter @mercadoya/orders-service db:migrate` antes de iniciar servicios. Las migraciones Catalog añaden la proyección y su contador de intentos, permiten NULL para detener la programación y conservan las tablas y filas históricas de Identity. La migración de reintentos reactiva una vez los errores del worker anterior, conservando los UUID remotos. `pnpm demo:infra` aplica ambas. Los productos Polar antiguos creados manualmente sin nuestra metadata no se adoptan por nombre; el worker crea los equivalentes asociados al UUID local.

```sh
pnpm exec turbo run build test --filter=@mercadoya/catalog-service...
# PostgreSQL dedicado; crea y elimina un schema temporal.
PRODUCTS_TEST_DATABASE_URL=<url-test> pnpm --filter @mercadoya/catalog-service test:integration
```

CI cubre solicitudes SDK, PEN, límites, secretos, transacciones, productos existentes, edición concurrente, réplica, reinicio, creación incierta y archivado. [ADR 0021](../../docs/adr/0021-polar-catalog-sync-pen.md) documenta la integración y sus límites. Documentación oficial verificada el 1 de octubre de 2026: [crear](https://polar.sh/docs/api-reference/products/create), [actualizar](https://polar.sh/docs/api-reference/products/update), [metadata](https://polar.sh/docs/api-reference/2026-04/products/list-products), [monedas](https://polar.sh/docs/features/products) y [organización](https://polar.sh/docs/api-reference/organizations/update).
