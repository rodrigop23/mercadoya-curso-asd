# MercadoYa API

API Hono para Node.js con acceso a PostgreSQL mediante Drizzle ORM y el driver `node-postgres` (`pg`).

Desde la raíz del monorepo, ejecuta `pnpm --filter @mercadoya/api dev`. La API responde en <http://localhost:3001>.

## Base de datos local

Desde la raíz del monorepo, copia `.env.example` a `.env` y levanta PostgreSQL con `docker compose up -d`. La variable `DATABASE_URL` configura tanto el cliente de la API como drizzle-kit.

Aplica el esquema de Drizzle con:

```sh
pnpm --filter @mercadoya/api db:push
```

Para generar migraciones versionadas usa `pnpm --filter @mercadoya/api db:generate` y después `pnpm --filter @mercadoya/api db:migrate`. El cliente y el esquema extensible están en `src/db/`.
