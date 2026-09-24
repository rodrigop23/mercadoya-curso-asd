# 5. Evolucionar a service-based pragmático: más módulos, API layer y schemas lógicos

## Status

Accepted

## Context

ADR 0001 mantiene **un** deploy y **una** DB. ADR 0003 delimitó Identity y Catalog por contrato. La teoría de sesión 4 describe **arquitectura basada en servicios**: servicios de dominio “gruesos” (orden de magnitud 4–12), UI separada, acceso remoto vía API, a menudo **base compartida**, sin el costo operativo de microservicios.

El journey de la práctica S4 necesita: publicar con foto, tomar un pedido, reservar stock y notificar. Eso no cabe limpio en solo Identity + Catalog sin mezclar responsabilidades (stock ≠ ficha de producto; “email” ≠ Orders).

También necesitamos un **API layer** explícito (gateway) como en la topología del material teórico, y evitar la “librería única de entidades” que hace que un cambio de tabla golpee a todos.

**Prerrequisito de producto (no es este ADR):** la UI de `apps/web` se pulirá con skills de IA (p. ej. Impeccable) **antes** de construir estas piezas; lo nuevo de S4 se apoya en esa base visual.

## Decision

Evolucionamos el monolito modular hacia un shape **service-based pragmático** *dentro del mismo proceso*:

**Módulos de dominio (gruesos):**
- `identity` — auth / roles (ya existe)
- `catalog` — productos / publicación (ya existe)
- `media` — pipeline de imagen (ADR 0004)
- `orders` — creación y estado de pedidos
- `inventory` — stock / reserva (separado de Catalog a propósito)
- `notifications` — stub de notificación (log / “email” demo)

**API layer:** un único Hono (o facade) monta rutas por módulo (`/identity`, `/catalog`, `/media`, `/orders`, …). La web habla solo con ese layer.

**Datos:** una Postgres (ADR 0002). Partición **lógica** por schema o prefijo (`identity_`, `catalog_`, `orders_`, `inventory_`, …). Prohibido que un módulo lea/escriba tablas de otro; la integración entre dominios es por **contrato síncrono** (poco) o **eventos** (ADR 0006).

**No** adoptamos: un deploy por módulo, Linked Server, BD por servicio obligatoria, ni microservicios “de verdad”.

### Implementación inicial

La partición lógica usa prefijos para las tablas nuevas: `media_`, `orders_`, `inventory_` y `notifications_`. Identity y Catalog conservan sus nombres de tabla V1 (`user`, `session`, `product`, entre otros) para no romper Better Auth ni los datos existentes. Cada módulo mantiene su `schema.ts`, y `apps/api/src/db/schema.ts` compone los esquemas para el cliente Drizzle.

El API layer conserva las rutas V1 `/api/auth/*`, `/api/me` y `/api/products`. Monta los módulos nuevos bajo `/api/media`, `/api/orders`, `/api/inventory` y `/api/notifications`. Identity y Catalog exponen además `/api/identity/health` y `/api/catalog/health`.

## Consequences

**Más fácil:** mapa mental alineado con Percy (service-based ≠ microservicios); demos de topología reales; Inventory y Notifications se pueden reaccionar por eventos sin inflar Catalog; camino de extracción futura por módulo.

**Más difícil / trade-offs:** más carpetas y disciplina de imports; el API layer es un hop más de diseño (aunque sea el mismo proceso); la BD compartida sigue permitiendo atajos si no hay lint/revisión.

**Seguimiento:** integración asíncrona entre Orders e Inventory/Notifications (ADR 0006).
