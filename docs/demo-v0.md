# Demo MercadoYa V0 naive

Walkthrough de 2–3 minutos para la clase. Este snapshot implementa productos naive, guarda las imágenes en `apps/api/uploads`, muestra el catálogo público y permite crear productos desde el panel admin.

## Preparar y levantar

Desde la raíz del repo:

```sh
cp .env.example .env
```

Si es una instalación nueva, reemplaza `BETTER_AUTH_SECRET` en `.env` por una clave aleatoria de al menos 32 caracteres, como indica el README. Luego:

```sh
docker compose up -d
pnpm install
pnpm --filter @mercadoya/api db:push
pnpm dev
```

Si la base está vacía, crea el admin una vez con el comando `auth create-admin` de la sección **Autenticación local** del README. Entra a <http://localhost:5173/login> con:

- Email: `admin@mercadoya.local`
- Contraseña: `MercadoYaLocalAdmin2026!`

`.env.example` contiene `DATABASE_URL`, `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL`. `.env` y `apps/api/uploads/` están ignorados por Git; la API crea `uploads/` al recibir la primera imagen.

## Walkthrough

1. Abre <http://localhost:5173/admin/products> e inicia sesión si se solicita.
2. Crea un producto de ejemplo, selecciona una imagen JPG, PNG o WebP de hasta 5 MB y pulsa **Crear producto**.
3. Abre <http://localhost:5173/catalog> y muestra el producto y su imagen.

## Mostrar el acoplamiento

Abre estos tres puntos durante la demo:

1. [`apps/api/src/index.ts`](../apps/api/src/index.ts): handlers de autenticación y productos, verificación del rol admin, escritura de la imagen y servidor estático en el mismo archivo.
2. [`apps/api/src/db/`](../apps/api/src/db/): `auth-schema.ts` y `product-schema.ts` comparten el mismo directorio y se exportan desde `schema.ts`.
3. [`apps/web/src/routes/admin.products.tsx`](../apps/web/src/routes/admin.products.tsx) y [`apps/web/src/routes/catalog.tsx`](../apps/web/src/routes/catalog.tsx): formulario admin y catálogo consumen directamente la API de productos.

## Volver al snapshot

La rama publicada `v0-naive` conserva este V0 como rama git (no como tag). Desde el clon local:

```sh
git checkout v0-naive
```
