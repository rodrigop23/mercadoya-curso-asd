# MercadoYa

Monorepo inicial para MercadoYa con pnpm workspaces y Turborepo. Incluye una app React con Vite y TanStack Router y una API mínima con Hono. Todavía no contiene funcionalidades de negocio.

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
