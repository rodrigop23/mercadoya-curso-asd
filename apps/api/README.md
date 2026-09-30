# MercadoYa API

API Hono en `:3001`, con Catalog, Media y la timeline. Identity corre en [su propio servicio](../identity-service/README.md); Orders, Inventory y Notifications tienen rutas directas desde Kong OSS `:8000`. API ya no monta Identity ni proxifica esos servicios.

Kong publica productos, imágenes y health. Protege mutaciones de Catalog y GET de eventos. Catalog verifica el JWT firmado y exige rol admin; la autorización directa con cookie todavía consulta la sesión en Identity mediante su contrato HTTP. Los servicios no importan Better Auth ni tablas Identity desde API.

Inventory llama internamente a stock usando `CATALOG_INTERNAL_TOKEN`; Notifications conserva `x-ingest-token` para POST de ingest. Esas rutas no se publican en Kong. No hay un secreto universal ni se cambia la autenticación S2S.

```sh
pnpm --filter @mercadoya/api db:migrate
pnpm --filter @mercadoya/identity-service db:migrate
```

La migración histórica se conserva y se adopta de forma idempotente para bases creadas mediante db:push. La configuración runtime solo incluye tablas de Catalog, Media y las tablas históricas de saga. Se retiraron db:push y db:generate para evitar eliminar las tablas Identity de la base compartida. Las futuras migraciones deben respetar el ownership de cada servicio.

Compose inicia API y monta `apps/api/uploads` para conservar las imágenes existentes. `pnpm demo:infra` configura LOCAL_UID/LOCAL_GID con el usuario host para permitir escrituras sin ejecutar API como root. Si arrancas API manualmente con Compose, crea ese directorio y configura ambas variables con `id -u` e `id -g`. Para ejecutarla en host, detén su contenedor y usa `pnpm --filter @mercadoya/api dev`, ajustando el upstream en Kong. `db:reset --yes` sigue siendo destructivo: elimina public y drizzle; después requiere reaplicar la migración Identity. Consulta [el README raíz](../../README.md) y [ADR 0017](../../docs/adr/0017-identity-kong-jwks.md).
