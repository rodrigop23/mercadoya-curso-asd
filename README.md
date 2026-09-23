# MercadoYa

Monorepo de MercadoYa con pnpm workspaces y Turborepo. Incluye una app React con Vite y TanStack Router y una API Hono. El V0 implementa productos naive, imágenes en disco local, catálogo público y creación desde el panel admin.

## Demo V0 naive

La rama congelada para la clase es [`v0-naive`](https://github.com/rodrigop23/mercadoya-curso-asd/tree/v0-naive). Sigue el [checklist de walkthrough](docs/demo-v0.md) para levantar el demo, recorrerlo y mostrar el acoplamiento de esta versión.

## Demo V1 modular

La rama `v1-modular` conserva el refactor de Identity y Catalog con acoplamiento por contrato. Sigue el [checklist de walkthrough](docs/demo-v1.md) para levantar la versión modular y recorrer los mismos flujos.

## Requisitos

- Node.js `24.14.1` o superior. El scaffold se creó usando el Node ya instalado en el sistema: `v24.14.1`.
- pnpm `11.8.0`. Usa el pnpm del sistema (`/opt/homebrew/bin/pnpm`); el proyecto no instala ni cambia versiones del runtime o del package manager.

El campo `engines` documenta el mínimo de Node, `.node-version` fija la versión utilizada para este proyecto y `packageManager` documenta pnpm.

## Instalar

```sh
pnpm install
```

## Base de datos local

La API usa Drizzle ORM con el driver `node-postgres` (`pg`). Copia la configuración de ejemplo, inicia PostgreSQL y aplica el esquema:

```sh
cp .env.example .env
docker compose up -d
pnpm --filter @mercadoya/api db:push
```

`BETTER_AUTH_SECRET` debe ser una clave aleatoria de al menos 32 caracteres. Puedes generarla con `openssl rand -base64 48` y guardarla en `.env`; `BETTER_AUTH_URL` apunta a `http://localhost:3001`.

`docker-compose.yml` conserva los datos en el volumen `postgres_data`. Para detener PostgreSQL ejecuta `docker compose down`; `docker compose down -v` también elimina el volumen y sus datos.

Los comandos de esquema disponibles son `pnpm --filter @mercadoya/api db:generate`, `db:migrate`, `db:push` y `db:studio`. Usa `db:generate` seguido de `db:migrate` para generar y aplicar migraciones SQL; `db:push` sincroniza el esquema directamente y está pensado para desarrollo local.

## Desarrollo

Inicia las dos aplicaciones en paralelo desde la raíz:

```sh
pnpm dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:3001>

También puedes iniciar una aplicación individualmente con `pnpm --filter @mercadoya/web dev` o `pnpm --filter @mercadoya/api dev`.

## Autenticación local

La API ofrece registro e inicio de sesión por email y contraseña en `/api/auth/*`, y `GET /api/me` devuelve la sesión actual o `401` si no hay una. El frontend debe enviar solicitudes con `credentials: 'include'` para conservar la cookie. CORS permite `http://localhost:5173` con credenciales.

Después de iniciar PostgreSQL y aplicar el esquema, crea el administrador demo una vez:

```sh
pnpm dlx auth@latest create-admin --config apps/api/src/modules/identity/auth.ts --email admin@mercadoya.local --password 'MercadoYaLocalAdmin2026!' --name 'Admin MercadoYa' --role admin --yes
```

Credenciales demo locales: `admin@mercadoya.local` / `MercadoYaLocalAdmin2026!`.

Registro e inspección de sesión con `curl` y un cookie jar:

```sh
curl -i -c /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo","email":"demo@mercadoya.local","password":"MercadoYaDemo2026!"}' \
  http://localhost:3001/api/auth/sign-up/email

curl -i -b /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  http://localhost:3001/api/me
```

Login admin, consulta de sesión y logout con el mismo cookie jar:

```sh
curl -i -c /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mercadoya.local","password":"MercadoYaLocalAdmin2026!"}' \
  http://localhost:3001/api/auth/sign-in/email

curl -i -b /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  http://localhost:3001/api/me

curl -i -b /tmp/mercadoya-cookies.txt -c /tmp/mercadoya-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://localhost:3001/api/auth/sign-out
```

## Comandos

```sh
pnpm build      # Construye web y API
pnpm typecheck  # Revisa TypeScript en las aplicaciones
pnpm lint       # Ejecuta oxlint en los paquetes
pnpm format     # Aplica oxfmt en los paquetes y la configuración de raíz
```

## Estructura

```text
apps/
  api/             Hono + TypeScript + Drizzle ORM
  web/             React + Vite + TanStack Router + TypeScript
packages/
  tsconfig/        Configuración compartida de TypeScript
```

La API parte del template `nodejs` de `create-hono`; la web parte del modo `router-only` de `@tanstack/cli` y conserva su estructura de rutas file-based en `apps/web/src/routes/`.

Turbo coordina `dev`, `build`, `lint`, `format` y `typecheck` a partir de los scripts de cada workspace. La web tiene una ruta inicial configurada con TanStack Router. Las tareas de desarrollo son persistentes y se ejecutan en paralelo.

## Toolchain del sistema

Se conservan las versiones instaladas en la máquina: Node `v24.14.1` y pnpm `11.8.0`. El campo `packageManager` está fijado a `pnpm@11.8.0`; no se requiere nvm, fnm, Volta ni Corepack para instalar otra versión.
