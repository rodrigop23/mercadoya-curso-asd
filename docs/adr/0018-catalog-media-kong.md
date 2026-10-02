# ADR 0018: Catalog y Media detrás de Kong

Estado: aceptado. Fecha: 2026-09-30.

## Decisión

Catalog y Media comparten `apps/catalog-service` en :3007. El CRUD ya llama al pipeline Media por contrato en memoria y publica imágenes locales. Separarlos requeriría un protocolo de upload y coordinación de archivos que este prompt no necesita. Se conservan contratos internos y DTO HTTP, full/thumb, compensación de imágenes ante fallo de persistencia y el UPDATE condicional atómico de stock.

Kong enruta `/api/products`, health de Catalog/Media y `/uploads` al nuevo proceso con `strip_path: false`. GET/HEAD y preflight son públicos. Las mutaciones usan `identity-auth`; convierte la sesión en JWT o verifica el Bearer con Identity. Catalog verifica RS256/JWKS, issuer, audience, expiración y rol admin, sin cliente de sesiones. No confía en headers de identidad del caller.

Inventory usa la URL interna `http://catalog:3007`. Se conservan paths y `x-catalog-internal-token`; no se mezcla con JWT ni token de Notifications. Kong bloquea `/api/internal/catalog` con 404.

## Compatibilidad y operación

PostgreSQL sigue compartido. El directorio Drizzle, su SQL y journal se trasladan de API a Catalog sin modificar la migración histórica. No se trasladan filas. La adopción idempotente de instalaciones creadas con db:push sigue disponible. Catalog aloja el baseline compartido; cada servicio conserva ownership de sus consultas y las migraciones nuevas deben ser explícitas. Identity conserva su migración propia.

Compose monta `apps/catalog-service/uploads` como bind mount de Catalog. `image_path` no cambia. `UPLOADS_DIR` permite usar ese directorio al ejecutar en host. Solo Catalog necesita Sharp y permisos de escritura.

Kong tiene `KONG_NGINX_HTTP_CLIENT_MAX_BODY_SIZE=3m`; Hono limita el cuerpo a 3145728 bytes antes de parsear multipart. La imagen mantiene 2097152 bytes. CORS permite los dos orígenes Vite con credenciales y preflight sin autenticación. Una petición con cookie desde otro origen falla en Identity. S3, mesh, JetStream/outbox, Polar y Federation quedan fuera.

## Documentación oficial verificada

Se consultaron estas fuentes el 2026-09-30 y se cotejaron las APIs con las versiones instaladas. Las páginas de Better Auth y Drizzle son documentación continua, sin selector para las versiones del lockfile; el código distribuido con npm es la referencia exacta utilizada para verificar sus opciones.

- Kong OSS 3.9.1, fijado en el Dockerfile: [modo declarativo DB-less](https://developer.konghq.com/gateway/db-less-mode/), [Routes](https://developer.konghq.com/gateway/entities/route/) y [Services](https://developer.konghq.com/gateway/entities/service/). Se verificaron también los schemas oficiales del tag [routes.lua](https://github.com/Kong/kong/blob/3.9.1/kong/db/schema/entities/routes.lua), [services.lua](https://github.com/Kong/kong/blob/3.9.1/kong/db/schema/entities/services.lua) y [defaults](https://github.com/Kong/kong/blob/3.9.1/kong/templates/kong_defaults.lua). El routing conserva el path completo y la configuración carga con database off.
- Better Auth 1.7.5 y adapter 1.7.5: [JWT/JWKS](https://better-auth.com/docs/plugins/jwt) y [sesiones](https://better-auth.com/docs/concepts/session-management). Se cotejó `better-auth/dist/plugins/jwt/index.mjs` de la distribución 1.7.5 y su implementación de sign/verify. `/token` requiere sesión y `/jwks` entrega claves públicas; issuer/audience explícitos evitan confundir transporte interno con identidad del emisor.
- [OpenAPI 3.1.0](https://spec.openapis.org/oas/v3.1.0.html), versión emitida por contracts: multipart con esquema de cada parte, respuestas 413 y alternativas de seguridad cookie/Bearer en Kong. Stock anuncia el header interno y su URL directa.
- Drizzle ORM 0.45.3 y Kit 0.31.11 del lockfile: [UPDATE con returning](https://orm.drizzle.team/docs/update) y [migraciones](https://orm.drizzle.team/docs/migrations). Se cotejaron `drizzle-orm/node-postgres/migrator.js`, el dialecto PostgreSQL y los tipos de UPDATE instalados. Se conserva el journal histórico y UPDATE suma delta con una condición de stock en SQL.

## Verificación

CI valida typecheck, lint, build, OpenAPI generado y contracts. El smoke Identity/Kong cubre además catálogo público, CRUD con cookie y Bearer, buyer 403, cookie directa 401, CORS en ambos orígenes, upload/full/thumb, límites, stock interno y reserva por Inventory. La demo saga conserva reserva, rechazo y compensación de pago.

Se ejecutaron los checks locales y una pila Compose aislada, sin cambiar el laboratorio activo. El smoke confirmó también reemplazo de una imagen mayor que 1 MiB, rechazo de imagen mayor que 2 MiB y formulario mayor que 3 MiB. La demo saga pasó confirmación, rechazo por stock, pago fallido con restitución y dos eventos duplicados sin doble liberación. Reaplicar la migración y reiniciar Catalog conservó una fila con stock y un archivo con path histórico.
