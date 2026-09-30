# MercadoYa Web

SPA de React 19, Vite y TanStack Router. Las rutas file-based viven en `src/routes/`; el plugin de TanStack genera `src/routeTree.gen.ts` al ejecutar Vite.

TanStack Query está disponible en el contexto del Router para precargar datos desde los loaders. La sesión y las acciones de autenticación usan Better Auth contra `http://localhost:8000`. Los componentes shadcn/ui usan Base UI y Tailwind CSS v4.

Desde la raíz del monorepo, ejecuta `pnpm --filter @mercadoya/web dev`. La web responde en <http://localhost:5173>.

Los componentes ShadCN/Base UI y el CSS de Tailwind v4 se importan de [`@mercadoya/ui`](../../packages/ui/README.md). Consulta esa guía para añadir componentes y mantener los aliases compartidos.
