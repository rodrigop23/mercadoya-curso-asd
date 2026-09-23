# 2. Elegir stack React + Vite + TanStack Router, Hono y Postgres

## Status

Accepted

## Context

Con el monolito primero ya decidido (ADR 0001), necesitamos un stack concreto para implementar MercadoYa (SPA + API + DB) de forma enseñable, productiva con AI coding agents, y sostenible en sesiones siguientes.

Restricciones y fuerzas:
- Preferimos TypeScript en cliente y servidor para un solo lenguaje.
- La UI es un SPA (catálogo + admin), no un sitio principalmente SSR.
- La base de datos debe aguantar evolución (nuevos módulos, relaciones, no solo un prototipo desechable).
- Evitamos “investigación eterna” de alternativas en clase; sí necesitamos dejar constancia de la elección.

## Decision

Adoptamos este stack para MercadoYa:

- **Frontend:** React + Vite + TanStack Router (SPA).
- **Backend (monolito):** Hono.
- **Base de datos:** PostgreSQL.

Alternativas consideradas y descartadas (resumen):
- Next.js full-stack: más opinión/acoplamiento framework; el curso quiere separar UI y API del monolito de forma explícita.
- Express/Fastify: válidos, pero Hono es liviano y encaja bien con TS moderno para un monolito pequeño.
- SQLite: más simple al inicio, peor señal para evolución y para hábitos de producción en el curso.

## Consequences

**Más fácil:** un lenguaje (TS) end-to-end; Vite acelera el front; Hono mantiene la API delgada; Postgres es un estándar que los alumnos reutilizarán; los agents suelen generar bien este combo.

**Más difícil / trade-offs:** hay que operar Postgres (local/Docker); SPA implica CORS/auth por cookie o token entre orígenes; TanStack Router es una elección específica que el equipo debe conocer (no es el default de create-react-app).

**Seguimiento:** la estructura modular Identity/Catalog (ADR 0003) se implementa *dentro* de este stack, sin cambiar de framework por subdominio.
