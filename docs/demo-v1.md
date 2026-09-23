# Demo MercadoYa V1 modular

Walkthrough de 2–3 minutos. Mantiene los flujos del V0 y muestra los límites entre Identity y Catalog dentro de un solo deploy Hono y una sola base PostgreSQL.

## Preparar y levantar

Desde la raíz del repo:

```sh
git checkout v1-modular
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

`.env.example` contiene `DATABASE_URL`, `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL`. `.env` y `apps/api/uploads/` están ignorados por Git; Catalog crea `uploads/` al recibir la primera imagen.

## Walkthrough funcional

1. Abre <http://localhost:5173/admin/products> e inicia sesión con el administrador demo.
2. Crea un producto, selecciona una imagen JPG, PNG o WebP de hasta 5 MB y pulsa **Crear producto**.
3. Abre <http://localhost:5173/catalog> y muestra el producto y su imagen.
4. Comprueba que un visitante sin sesión no pueda crear productos (`POST /api/products` responde `401`) y que una cuenta con rol `user` reciba `403`.

## Mostrar el contrato

Abre estos tres archivos para recorrer la dependencia:

1. [`identity/contract.ts`](../apps/api/src/modules/identity/contract.ts): operaciones que Identity ofrece a los otros módulos, incluida la autorización admin.
2. [`identity/service.ts`](../apps/api/src/modules/identity/service.ts): implementación del contrato que encapsula Better Auth y el chequeo de rol.
3. [`catalog/routes.ts`](../apps/api/src/modules/catalog/routes.ts): Catalog recibe `IdentityContract` y pide autorización; no importa Better Auth ni lee la sesión o tablas de usuario.

El wiring del monolito está en [`apps/api/src/index.ts`](../apps/api/src/index.ts). Identity y Catalog mantienen sus esquemas en sus carpetas; ambos importan la única instancia Drizzle y el pool compartido de [`db/index.ts`](../apps/api/src/db/index.ts). `db/schema.ts` reúne los esquemas para esa instancia y para los comandos de Drizzle Kit.

## Contrastar con V0

La rama publicada `v0-naive` conserva el snapshot previo con handlers, auth, validación y uploads mezclados en `index.ts`. La checklist de ese recorrido está en [`demo-v0.md`](./demo-v0.md). V1 conserva su historial en la rama `v1-modular`.
