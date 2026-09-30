# Orders service

Proceso Node/Hono para crear y consultar pedidos. Escucha en `http://localhost:3002` y conserva el ciclo `pending` → `confirmed` o `rejected`. Publica `orders.placed` y consume los resultados de Inventory y Payment por NATS.

Usa el mismo `DATABASE_URL` PostgreSQL que `@mercadoya/api` y la tabla existente `orders_order`. Por ahora, las migraciones de esa tabla siguen en `apps/api/drizzle`; `pnpm --filter @mercadoya/api db:migrate` aplica el esquema. La separación de bases queda para una fase posterior.

Variables en el `.env` de la raíz:

| Variable | Valor local | Uso |
| --- | --- | --- |
| `PORT` | `3002` por defecto | Puerto del servicio. Si arrancas todo con `pnpm dev`, deja la variable sin definir para no cambiar el puerto del API. |
| `DATABASE_URL` | URL de PostgreSQL de Compose | Base compartida con el API. |
| `EVENT_BUS` | `nats` | Es el único transporte admitido por Orders. |
| `NATS_URL` | `nats://localhost:4222` | Servidor NATS. Orders falla al arrancar si no conecta. |
| `IDENTITY_URL` | `http://localhost:3006` | JWKS de Identity para verificar JWT. |
| `ORDERS_SERVICE_URL` | `http://localhost:3002` | Destino del proxy del API; se configura en el API. |

Compose inicia Orders. `pnpm dev` inicia web y MF. El navegador llama a Kong `:8000/api/orders` con cookie de sesión o Bearer JWT. Kong valida la credencial con Identity y reenvía un JWT. Orders verifica RS256, kid, issuer, audience, subject, role y expiración mediante JWKS, sin llamar a `/api/me`. El buyerId procede del claim sub. POST y GET de pedidos requieren autenticación; health permanece público. Acceso directo al servicio requiere Bearer, nunca solo cookie. `JWT_ISSUER=http://localhost:8000` y `JWT_AUDIENCE=mercadoya-services` coinciden con Identity. Consulta [Identity](../identity-service/README.md).

## Saga por coreografía y compensación

Orders conserva `pending` después de `inventory.reserved`. Solo `payment.succeeded` lo cambia a `confirmed`. `inventory.rejected` o `payment.failed` lo cambian a `rejected`. Inventory v2 escucha `payment.failed`, restaura el stock y publica `inventory.released`; Orders también consume ese evento como cierre de la compensación. El rechazo puede verse antes de que termine la liberación, por eso la demo espera ambos resultados. Las actualizaciones solo afectan pedidos `pending`, de modo que los eventos duplicados no reescriben estados finales.

El módulo `src/payment/simulator.ts` escucha `inventory.reserved` y publica el resultado simulado. Vive en el proceso de Orders por comodidad de clase, pero participa como otro consumidor NATS: no llama a Inventory, no coordina pasos y no es un bounded context de pagos. No hay cobro real. `PAYMENT_MODE=succeed` es el valor por defecto; configura `PAYMENT_MODE=fail` en `.env` y reinicia Orders para fallar compras desde la UI. El CLI puede elegir el resultado por pedido sin cambiar esa variable.

Ejecuta la [demo de saga](../../scripts/README.md) con `pnpm demo:saga`. No requiere cookie porque llama al servicio interno de creación, con `buyerId: null`, no al POST público autenticado.
