# Demo MercadoYa V3: servicios y saga

Checklist de clase para el freeze S5 en `v3-services`. Recorre el MF admin, los tres desenlaces de compra y el versionado de Inventory.

## 1. Prerrequisitos

- [ ] Confirma la rama `v3-services` con `git branch --show-current`.
- [ ] Usa Node.js `24.14.1` o superior y pnpm `11.8.0` del sistema. Comprueba `node --version`, `pnpm --version` y Docker con Compose activo.
- [ ] Prepara `.env` sin sobrescribir uno existente:

  ```sh
  if [ ! -f .env ]; then cp .env.example .env; fi
  openssl rand -base64 48
  ```

  Genera un valor distinto para cada secreto y guárdalo en `BETTER_AUTH_SECRET`, `CATALOG_INTERNAL_TOKEN`, `NOTIFICATIONS_INGEST_TOKEN` y `NOTIFICATIONS_INVOKE_TOKEN`. El primero requiere al menos 32 caracteres. No subas `.env` a Git.

- [ ] Conserva `EVENT_BUS=nats`, `NATS_URL=nats://localhost:4222` y `PAYMENT_MODE=succeed`. Deja `NOTIFICATIONS_FUNCTION_URL` vacía para la demo local sin AWS.
- [ ] Para simular correo usa `EMAIL_MODE=stub`. Para inbox real configura `RESEND_API_KEY`, `RESEND_FROM` con un dominio verificado, `DEMO_NOTIFY_EMAIL` y `EMAIL_MODE=resend`, siguiendo la [guía de Notifications](../apps/notifications-lambda/README.md#correo-real-y-smoke). Todos los pedidos envían al destinatario de clase, incluso los del CLI.

## 2. Arranque

Desde la raíz, ejecuta en este orden:

```sh
pnpm install
pnpm demo:infra
pnpm dev
```

`demo:infra` inicia Postgres y NATS, aplica el esquema y construye e inicia ambas versiones de Inventory. `pnpm dev` queda activo en esa terminal e inicia web, MF, gateway, Orders y bridge. Espera a que el gateway esté listo antes de comprar.

| Pieza | Puerto del host | Ejecución |
| --- | --- | --- |
| Web host | 5173 | Vite |
| MF catálogo admin | 5174 | Vite independiente, iframe en el host |
| API gateway/BFF | 3001 | Node, con Identity, Catalog y Media |
| Orders y simulador de pago | 3002 | Node, sin proceso de pago separado |
| Inventory v1 / v2 | 3003 / 3005 | Contenedores Compose |
| Notifications bridge | 3004 | Node, invoca el handler local |
| Postgres / NATS | 5432 / 4222 | Contenedores Compose |

## 3. Health rápido

- [ ] En otra terminal, confirma `docker compose ps` y consulta estas URLs con `curl -i`. Todas pasan por el gateway y deben responder `200`.

| Pieza | URL |
| --- | --- |
| Identity en gateway | <http://localhost:3001/api/identity/health> |
| Orders | <http://localhost:3001/api/orders/health> |
| Inventory v1 | <http://localhost:3001/api/inventory/v1/health> |
| Inventory v2 | <http://localhost:3001/api/inventory/v2/health> |
| Notifications | <http://localhost:3001/api/notifications/health> |

Estos healthchecks comprueban que los procesos responden; el recorrido de compra comprueba la integración.

## 4. Admin y MF

- [ ] En una base nueva, crea el admin una vez, después de aplicar el esquema:

  ```sh
  pnpm dlx auth@latest create-admin --config apps/api/src/modules/identity/auth.ts --email admin@mercadoya.local --password 'MercadoYaLocalAdmin2026!' --name 'Admin MercadoYa' --role admin --yes
  ```

- [ ] Inicia sesión en <http://localhost:5173/login> con `admin@mercadoya.local` / `MercadoYaLocalAdmin2026!`.
- [ ] Abre <http://localhost:5173/admin/products>. Comprueba que el iframe carga desde `:5174` y que sus solicitudes de Catalog van a `:3001` con sesión.
- [ ] Crea un producto dedicado con al menos cinco unidades, edita su título o precio y comprueba el cambio en `/catalog`. Crea y elimina otro producto descartable para completar el CRUD. Conserva el primero para las compras y anota su UUID.

## 5. Buyer, confirmación y timeline

- [ ] Crea la cuenta buyer de ejemplo si aún no existe. No hay que asumir un seed: el [README de autenticación](../README.md#autenticación-local) muestra el registro con `demo@mercadoya.local` / `MercadoYaDemo2026!`. También puedes registrarla desde `/register`.
- [ ] En otra sesión de navegador, entra con ese buyer y abre <http://localhost:5173/catalog>. Pide una unidad del producto dedicado.
- [ ] En `/orders/<orderId>`, espera `confirmed` y comprueba que el stock bajó una unidad. La confirmación depende de `payment.succeeded`, después de reservar y simular el pago.
- [ ] Revisa la timeline del pedido o <http://localhost:5173/events>. Debe aparecer `notification.stub` o `notification.email`. Consulta también `GET http://localhost:3001/api/events?orderId=<orderId>` para ver `emailStatus`.
- [ ] Si configuraste Resend, comprueba el correo "Pedido confirmado". `emailStatus=sent` significa aceptación por Resend; revisa el inbox para comprobar la entrega.

## 6. Pago fallido y compensación

- [ ] Ejecuta la prueba reproducible con un producto dedicado que conserve al menos dos unidades, sin compras simultáneas:

  ```sh
  pnpm demo:saga
  # Para elegir el producto, sustituye el UUID:
  DEMO_PRODUCT_ID=UUID_DEL_PRODUCTO pnpm demo:saga
  ```

  Usa una de las dos variantes. El CLI comprueba pago OK, stock insuficiente y pago fallido, y publica fallos duplicados para comprobar idempotencia de la liberación. Debe terminar con código `0`. Crea tres pedidos persistentes y consume una unidad en el caso exitoso; no borra pedidos ni repone esa unidad. Muestra los IDs y abre sus timelines. El CLI verifica saga y stock; comprueba las notificaciones aparte.

- [ ] Para mostrar el fallo desde la UI, como alternativa cambia `PAYMENT_MODE=fail` en `.env` y reinicia Orders. Puedes detener `pnpm dev` con Ctrl+C y volver a ejecutarlo para reiniciar los procesos locales. Compra con stock suficiente y espera `rejected`; verifica la restauración del stock, que puede terminar después del rechazo y del correo. Devuelve `PAYMENT_MODE=succeed` y reinicia de nuevo.
- [ ] Comprueba `notification.stub` o `notification.email` del fallo de pago y, si hay Resend, "El pago no se completó". La compensación se observa también en `docker compose logs inventory-v2` por `inventory.released`.

## 7. Rechazo por stock

- [ ] Usa el caso de stock del CLI anterior o crea un pedido autenticado con cantidad mayor al stock actual. El formulario de catálogo bloquea esa cantidad, así que para la prueba manual usa la API.

  Inicia sesión como buyer para guardar la cookie:

  ```sh
  curl -i -c /tmp/mercadoya-v3-cookies.txt \
    -H 'Origin: http://localhost:5173' \
    -H 'Content-Type: application/json' \
    -d '{"email":"demo@mercadoya.local","password":"MercadoYaDemo2026!"}' \
    http://localhost:3001/api/auth/sign-in/email
  ```

  Sustituye el UUID y elige una cantidad superior al stock del producto dedicado:

  ```sh
  curl -i -b /tmp/mercadoya-v3-cookies.txt \
    -H 'Content-Type: application/json' \
    -d '{"productId":"UUID_DEL_PRODUCTO","quantity":999999}' \
    http://localhost:3001/api/orders
  ```

- [ ] El POST responde `202` con `order.id`. Abre `/orders/<orderId>` y espera `rejected` por stock, sin pago ni cambio de stock. Comprueba su notificación en la timeline y, si hay Resend, "No pudimos completar tu pedido". Los tres tipos de correo corresponden a tres desenlaces distintos, no a tres correos por pedido.

## 8. Inventory v1 frente a v2

- [ ] Compara health, JSON y cabeceras:

  ```sh
  curl -i http://localhost:3001/api/inventory/v1/health
  curl -i http://localhost:3001/api/inventory/v2/health
  ```

  El JSON contiene `serviceVersion: "v1"` o `"v2"`, y `X-Service-Version` coincide con la versión.

- [ ] Con la cookie del paso 7 y el UUID de un pedido confirmado del paso 5, consulta la reserva v2 por defecto:

  ```sh
  ORDER_ID=UUID_DEL_PEDIDO_CONFIRMADO
  curl -i -b /tmp/mercadoya-v3-cookies.txt "http://localhost:3001/api/inventory/v2/reservations/$ORDER_ID"
  ```

  Para comparar compatibilidad, consulta explícitamente `/api/inventory/v1/reservations/$ORDER_ID` con la misma cookie. Ambas versiones leen la misma tabla. V2 añade `reservation.status: "reserved"`; V1 no incluye ese campo. Solo V2 consume eventos para reservar y compensar. Usa un pedido confirmado: tras compensar, la reserva se elimina y su consulta responde `404`. Sin sesión, ambas lecturas responden `401`.

## 8bis. Explorar Inventory OpenAPI con Swagger

- [ ] Abre [Swagger UI de Inventory](http://localhost:3005/docs). Requiere internet para cargar los recursos de Swagger desde el CDN. Comprueba también el [YAML servido](http://localhost:3005/openapi.yaml), que corresponde a `apps/inventory-service/openapi.yaml`.
- [ ] Localiza `health` y `reservations` v1/v2 en el mismo documento. V1 está marcado como deprecated; el alias sin versión usa v2. Expande ambas lecturas de reservas y compara los schemas de respuesta: solo v2 exige `reservation.status: "reserved"`.
- [ ] Expande `GET /api/inventory/v2/health` y pulsa **Try it out**. En el selector general **Servers**, elige el server directo `http://localhost:3005` y pulsa **Execute**. Debe responder `200` con `serviceVersion: "v2"` y `X-Service-Version: v2`.
- [ ] Opcional: abre [Swagger UI v1 retenido](http://localhost:3003/docs), expande `/api/inventory/v1/health`, pulsa **Try it out**, selecciona en **Servers** el server directo `http://localhost:3003` y ejecuta la solicitud. Responde `200` con la versión v1. El contrato es el mismo en ambos procesos; el deploy decide qué paths atiende cada uno.
- [ ] Para probar reservations con sesión, usa los comandos vía gateway y cookie del paso 8. Swagger permite explorar schemas sin iniciar sesión; Execute puede responder `401` sin cookie. Seleccionar otro origen puede causar un bloqueo CORS. Para health, conserva el server del mismo origen que la UI.

## 9. Apagado y notas

- [ ] Deja `PAYMENT_MODE=succeed`, detén `pnpm dev` con Ctrl+C y ejecuta `docker compose down`. Conserva el volumen de Postgres para la próxima clase; `down -v` lo elimina.
- [ ] La timeline vive en memoria y se pierde al reiniciar el API. NATS Core no reproduce eventos. Guarda los IDs o evidencia antes de apagar.
- [ ] Sin `DEMO_NOTIFY_EMAIL`, Notifications registra un stub por falta de destinatario. Con `EMAIL_MODE` vacío y sin key también usa stub. Si fuerzas Resend con destinatario pero sin key o remitente, registra error de correo. El error no revierte la saga.
- [ ] El CLI duplica fallos para verificar stock: la timeline puede contener notificaciones repetidas. Resend usa una clave de idempotencia por subject y pedido.

## 10. Referencias y publicación

- [ADR 0015: saga y compensación](adr/0015-saga-coreografia-compensacion.md).
- [ADR 0011: bridge, Lambda y Resend](adr/0011-notifications-lambda-bridge.md).
- [Secuencia canónica de saga y email](diagrams/seq-order-placed-fanout-v3.md).
- [README de Notifications](../apps/notifications-lambda/README.md).
- [README del CLI de saga](../scripts/README.md).
- [Inventory y versionado HTTP](../apps/inventory-service/README.md).
- [C4 de contenedores V3](diagrams/c4-2-containers-v3.md) y [componentes V3](diagrams/c4-3-components-v3.md).

El cierre queda en un commit local de documentación en `v3-services`. Estado de publicación: pendiente de push. Cuando el docente autorice publicar, ejecutar:

```sh
git push origin v3-services
```

Si el curso usa tags, el nombre propuesto es `v3.0.0-s5`. Su creación y publicación son opcionales y quedan pendientes de decisión docente:

```sh
git tag -a v3.0.0-s5 -m 'Freeze S5: servicios, saga y correo'
git push origin v3.0.0-s5
```

Un PR o merge a `dev` se hará solo por pedido del docente. No hay merge automático a `main`. Conserva las ramas de freeze `v0-naive`, `v1-modular` y `v2-integration`. El guion largo y los prompts docentes de Desktop `mercadoya/sesion-5/` permanecen fuera del repo alumno.
