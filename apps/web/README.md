# MercadoYa Web

Scaffold de React, Vite y TanStack Router creado con `@tanstack/cli` en modo router-only.

Las rutas file-based están en `src/routes/` y el árbol inicial generado por TanStack está versionado en `src/routeTree.gen.ts`. Para mantener Prettier fuera del lockfile, el generador automático no queda instalado; al agregar o renombrar archivos de ruta, regenera ese árbol con el CLI de TanStack.

Desde la raíz del monorepo, ejecuta `pnpm --filter @mercadoya/web dev`. La web responde en <http://localhost:5173>.
