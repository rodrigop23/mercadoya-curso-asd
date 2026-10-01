# Contratos HTTP y eventos

`@mercadoya/contracts` contiene schemas Zod 4, tipos HTTP y puertos de Inventory/Catalog. No importa DB, Drizzle, módulos de apps, secretos ni URLs de infraestructura. Los servicios mantienen persistencia y transporte. Contracts `3.0.0` retira los exports HTTP de versiones anteriores de Inventory. `reservationResponseSchema` y `ReservationResponse` representan el único DTO vigente; los eventos conservan `version: 1`.

## Specs y ownership

| Contrato                            | Spec versionada                                            | Owner de implementación                                                                       |
| ----------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Inventory HTTP                      | [Inventory](../../apps/inventory-service/openapi.yaml)     | `apps/inventory-service`                                                                      |
| Orders HTTP                         | [Orders](../../apps/orders-service/openapi.yaml)           | `apps/orders-service`                                                                         |
| Identity, login y sesión            | [Identity](../../apps/identity-service/openapi.yaml)       | `apps/identity-service`                                                                       |
| Catalog público y stock interno     | [Catalog](../../apps/catalog-service/openapi/catalog.yaml) | `apps/catalog-service/src/modules/catalog`                                                    |
| Media, health y lectura de imágenes | [Media](../../apps/catalog-service/openapi/media.yaml)     | Media procesa imágenes; Catalog monta `/uploads/*`                                            |
| NATS saga v1                        | [JSON Schemas por subject](events.schema.json)             | Orders publica pedidos y resultados de Polar; Inventory publica reserva, rechazo y liberación |

El owner del módulo revisa su spec y los schemas en cada cambio de handler. Los owners de consumidores afectados deben revisar cambios incompatibles. Identity corre en su servicio propio; Catalog y Media comparten `apps/catalog-service` en :3007. Media recibe `image` mediante multipart de Catalog, no tiene una ruta independiente de upload. Identity documenta los endpoints que usan la web y los servicios; el catch-all GET/POST `/api/auth/*` también delega endpoints del proveedor Better Auth y su plugin admin. No declaramos esos endpoints adicionales como contratos propios de MercadoYa.

El server principal es Kong local `http://localhost:8000`. Orders también anuncia `3002`; Inventory declara un único server directo en `3003`. Estos servers son ejemplos locales en las specs, no forman parte de los DTO. No hay URLs internas ni tablas en el paquete publicado.

## Generación desde código

La estrategia es **generate-from-code**. [Schemas HTTP](src/http.ts) y [schemas de eventos](src/index.ts) son la fuente de los payloads. Los handlers importan los mismos validadores de entrada. [El generador](scripts/openapi.mjs) mantiene los metadatos HTTP, códigos de respuesta, seguridad, multipart, deprecación y servers junto al catálogo de schemas. No arranca apps, no necesita `.env`, Postgres ni NATS. El generador exporta OpenAPI `3.1.0`, compatible con JSON Schema 2020-12 y las herramientas fijadas; revisar la edición más reciente de OpenAPI no obliga a migrar el dialecto.

Herramientas fijadas en `package.json` y `pnpm-lock.yaml`: Zod `4.6.5` con `z.toJSONSchema`, `yaml` `2.8.1` y Redocly CLI `2.0.0`. Redocly usa el ruleset `spec`, referencias resolubles, operationId obligatorio y único, y seguridad definida. Los scripts transitorios de `core-js` y `protobufjs` quedan deshabilitados en pnpm; no se requieren para lint.

Desde la raíz:

```sh
pnpm install --frozen-lockfile
pnpm openapi:generate
pnpm openapi:check
pnpm typecheck
pnpm test
```

La generación escribe las cinco specs y `events.schema.json` con orden estable, sin timestamps ni introspección de DB. Se versionan estos archivos en Git. No se editan a mano. `openapi:check` regenera en memoria, compara byte a byte y después ejecuta Redocly. CI ejecuta ese paso sin cache de Turbo, por lo que también detecta ediciones manuales en specs fuera del workspace de contracts. `typecheck` valida los consumidores y `test` amplía la suite de 01 con parse de los nuevos DTOs y regresiones de seguridad/servers. Se conserva la suite de eventos y Notifications.

Zod transforma `price`/`stock` de multipart a números después de validar strings y trim. JSON Schema describe la entrada; los límites posteriores a esa transformación figuran en las descripciones y los tests de parse. El refinement `delta !== 0` se expresa además como `not: { const: 0 }` en OpenAPI. El archivo de imagen se describe como binary; Media valida MIME, firma y tamaño máximo de 2 MiB. No se intentan convertir Dates, Files o transforms de salida a schemas JSON. Las respuestas HTTP usan fechas ISO serializadas, no tipos de DB.

## Auth actual

La web envía la cookie Better Auth con `credentials: include`. En localhost se llama `better-auth.session_token`; HTTPS puede añadir `__Secure-`. El token en las respuestas del proveedor es opaco, no implica Bearer JWT. Kong admite sesión browser o Bearer JWT para crear y leer pedidos, consultar reservas y mutar productos. Orders, Inventory y Catalog verifican el JWT upstream mediante JWKS; health y lectura de catálogo/imágenes son públicos. Inventory no compara el comprador. Catalog exige rol `admin` para escritura; el stock interno usa `x-catalog-internal-token` solo en la URL directa :3007, y Kong lo bloquea con 404. Los formularios admiten hasta 3 MiB en Kong y Hono; una imagen admite hasta 2 MiB.

`/api/me` devuelve sesión/usuario o 401; `/api/auth/get-session` puede devolver `null` con 200. Los schemas de respuestas del proveedor admiten campos adicionales de plugins. El schema `sessionBuyerSchema` permanece como adapter de sesión. Orders e Inventory obtienen sub de un JWT verificado por JWKS. `applicationJwtClaimsSchema`, `applicationTokenResponseSchema` y `publicJwksSchema` describen el nuevo contrato; el schema de claims no sustituye la comprobación criptográfica. Los tipos de puertos que usan `Date` o `File` siguen siendo adapters del módulo, no DTO HTTP.

## Versionado y breaking changes

La versión del paquete usa SemVer. Correcciones de documentación/generación sin cambiar wire usan patch; campos opcionales compatibles usan minor. Quitar o renombrar campos, hacer un campo obligatorio, estrechar validaciones, cambiar tipos, auth o significado de estados requiere major, spec con `info.version` actualizado y migración explícita. Aumentar solo `info.version` no migra consumidores.

Antes de integrar un breaking change, el PR debe incluir el bump de `packages/contracts/package.json`, actualizar la versión del documento afectado en el generador y documentar ruta/subject nuevo, consumidores afectados y periodo de deprecación en un ADR. Si se requiere compatibilidad temporal, el ADR fija la condición de retirada y marca las operaciones anteriores con `deprecated: true`. Inventory retira esa compatibilidad en esta rama y migra sus consumidores a la ruta sin versión, según ADR 0008. No se permite cambiar silenciosamente un schema existente. La revisión de owners exige esa evidencia; lint y comparación reproducible no sustituyen la revisión semántica de compatibilidad.

Los eventos mantienen exactamente `orders.placed`, `inventory.reserved`, `inventory.rejected`, `inventory.released`, `payment.succeeded` y `payment.failed`. Todos llevan `version: 1`, `orderId` como correlación, `productId`, `quantity`, `buyerId` y `occurredAt`. `buyerId: string | null` se conserva por compatibilidad, aunque Orders público obtiene el ID de sesión. `payment.failed.reason` tiene 1 a 160 caracteres y `inventory.rejected.reason` conserva las causas actuales. Orders guarda el precio PEN de Catalog antes de publicar. Los resultados de pago llevan correlación opcional de Polar, compatible con consumidores v1.

Para eventos incompatibles se añade un schema con `version` nuevo y subject versionado acordado, con publicación/consumo paralelo durante la migración. No se sustituye el payload de un subject v1 con datos incompatibles. Los tests de parse deben cubrir ambos contratos y su correlación antes de retirar v1.

Inventory anuncia `info.version: 5.0.0` por retirar las rutas versionadas y el DTO anterior. Orders anuncia `2.1.0` por los endpoints aditivos de checkout/webhook Polar e Identity `2.0.0`. Contracts `2.1.0` conserva eventos `version: 1` y añade `provider`, `eventId`, `checkoutId` y `providerOrderId` opcionales a pagos/liberación. Los eventos previos siguen siendo válidos. El DTO de checkout contiene solo enlace, ID, importe, moneda y expiración; los secretos no forman parte de contracts. Checkout exige comprador autenticado; webhook usa firma pública sin sesión/JWT. La correlación Polar y las reglas de saga están en [Orders](../../apps/orders-service/README.md) y [ADR 0019](../../docs/adr/0019-polar-payments-saga.md).

## Referencias verificadas

Consultadas el 30 de septiembre de 2026: [OpenAPI 3 vigente](https://spec.openapis.org/oas/latest.html), [Zod 4, JSON Schema y límites de representación](https://zod.dev/json-schema), [Zod 4, validadores y transforms](https://zod.dev/api), [Redocly lint](https://redocly.com/docs/cli/commands/lint), [configuración de reglas](https://redocly.com/docs/cli/guides/configure-rules) y [cookies Better Auth](https://better-auth.com/docs/concepts/cookies). Las respuestas delegadas se contrastaron además con el código instalado de Better Auth `1.7.5`, fijado por el lockfile.

Inventory usa un solo contrato en `/api/inventory/*`, con `reservation.status: "reserved"`. Un único contenedor reserva y compensa; los subjects y schemas NATS siguen en version 1. La dualidad histórica permanece en la rama `v3-services`.

La versión 2.2.0 añade `BillingProduct` y `CatalogBillingResponse` para la API interna Catalog→Orders. La moneda es `pen` y el importe unitario está en céntimos de sol, entre 200 y 99999999. La validación multipart comparte el rango S/ 2.00 a S/ 999,999.99. La saga conserva los subjects y eventos `version: 1`; el precio se guarda en Orders sin añadir campos a los eventos.
