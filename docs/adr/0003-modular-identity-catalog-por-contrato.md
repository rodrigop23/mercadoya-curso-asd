# 3. Modularizar el monolito en Identity y Catalog con acoplamiento por contrato

## Status

Accepted

## Context

Tras el monolito naive (V0), Identidad (registro/login/roles) y Catálogo (alta de productos y listado público) vivían en el mismo deploy — correcto según ADR 0001 — pero el código mezclaba modelos e internos (acoplamiento intrusivo / de modelo / funcional). Un cambio en autenticación podía tocar archivos de productos.

La teoría de la sesión pide delimitar subdominios y preferir **acoplamiento por contrato** (solo interfaces explícitas). El journey actual solo justifica dos subdominios claros: Identidad y Catálogo. Aún no hay carrito, pedidos ni notificaciones.

Queremos bajar el dolor de cambio **sin** pasar a microservicios (sigue siendo un monolito, una DB, un deploy).

## Decision

Organizamos el backend (y, donde aplique, el front por features) en módulos **`identity`** y **`catalog`**:

- Identity expone `IdentityContract` con `getSession(headers)` y `requireAdmin(headers)`. Catalog recibe ese contrato al componerse y lo usa al proteger la creación de productos.
- Queda **prohibido** importar implementaciones internas, tablas o modelos privados del otro módulo.
- Catálogo no modela usuarios: para proteger el admin pregunta al contrato de Identidad (p.ej. `requireAdmin()` / `currentUser()`).
- Better Auth vive dentro de Identity. Catalog no importa Better Auth, el esquema de usuarios ni inspecciona `session.user.role`.
- `identity/schema.ts` y `catalog/schema.ts` son dueños de sus tablas. Cada módulo configura su cliente Drizzle con su esquema; ambos comparten el pool de `db/connection.ts`. `db/schema.ts` reúne los esquemas para Drizzle Kit, mientras que las consultas de productos se quedan en Catalog.
- `apps/api/src/index.ts` compone ambos módulos en el mismo Hono. Se mantiene un deploy y una base PostgreSQL.
- En la web, la ruta admin compone el gate de Identity con el formulario de Catalog.

Esta decisión documenta el paso V0 → V1 (monolito modular). Las capas (presentación / negocio / datos) pueden aplicarse *dentro* de cada módulo en un paso posterior; no son microservicios.

## Consequences

**Más fácil:** cambios de auth quedan localizados en Identity; Catálogo evoluciona su modelo de Producto con menos cascadas; el contraste pedagógico V0 vs V1 es visible.

**Más difícil / trade-offs:** hay que disciplinar imports mediante revisión; al inicio cuesta un poco más que un solo `services/`; una sola DB aún permite acoplamiento “por la puerta de atrás” si alguien consulta tablas ajenas — el contrato no basta sin revisión.

**Seguimiento:** si aparece Carrito/Pedidos, nuevo ADR de límites; si se extrae un módulo a proceso remoto, nuevo ADR (y las falacias de sistemas distribuidos pasan a ser operativas).
