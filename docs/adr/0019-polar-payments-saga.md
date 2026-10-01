# 0019: Polar checkout y webhook en la saga existente

Estado: aceptado. Fecha: 2026-09-30. Precios y relación de productos ampliados por [ADR 0021](0021-polar-catalog-sync-pen.md).

## Decisión

Orders aloja el adapter Polar y el worker de pagos. `inventory.reserved` guarda una solicitud de checkout y la web consulta su enlace. El único proveedor por defecto es Polar sandbox. El simulador histórico requiere `PAYMENT_PROVIDER=simulator` y no se suscribe junto con Polar.

Se fija `@polar-sh/sdk@1.0.1` con API `2026-04`. El webhook público de Kong verifica Standard Webhooks sobre raw body y headers firmados, valida el payload y persiste un resultado normalizado antes de responder `202`. La publicación NATS ocurre en un worker posterior; la clave del inbox es `webhook-id`.

Los subjects siguen en `version: 1`. Contracts pasa de `2.0.0` a `2.1.0` por el DTO HTTP de checkout y los campos opcionales `provider`, `eventId`, `checkoutId` y `providerOrderId`. Los consumidores anteriores aceptan los eventos sin esos campos y pueden descartar los nuevos. Inventory conserva la correlación al compensar y Notifications sigue consumiendo los mismos subjects. La spec de Orders pasa a `2.1.0` con endpoints aditivos; las rutas anteriores conservan sus reglas.

`order.paid` confirma solo si checkout, importe y moneda corresponden a la solicitud del servidor. Un checkout fallido/expirado o una orden anulada producen `payment.failed`. Inventory aplica su liberación idempotente existente. El primer estado terminal queda fijo. El regreso del navegador, `checkout.confirmed` y cancelaciones de suscripciones no acreditan el resultado de esta compra.

Un advisory lock PostgreSQL serializa los workers entre réplicas. Los queue groups reparten los eventos de Orders entre instancias. Publicar antes del commit permite repetir una publicación tras una caída, con el mismo event id; los consumidores mantienen sus reglas de idempotencia.

## Consecuencias

El inbox conserva y reintenta eventos aceptados, con entrega at-least-once al publisher. NATS Core continúa sin persistencia/replay ni ACK de consumidor; los consumidores desconectados pueden perder mensajes. No se incorpora un outbox ni JetStream.

El SDK actual no expone una clave de idempotencia para crear checkout. Un POST incierto se recupera buscando la sesión por metadata, sin crear otra ni liberar stock que podría cobrarse. Si Polar no creó la sesión, la reactivación exige comprobarlo primero. El README documenta ese límite operativo.

Los tokens y el secreto del webhook quedan solo en env. La base almacena la URL de checkout con acceso HTTP limitado al comprador, pero no `client_secret`, firmas ni payloads completos. La configuración original de importes en env fue sustituida por sincronización automática de Catalog y precios PEN, según ADR 0021.

## Validación

Las pruebas unitarias usan claves efímeras, firma Standard Webhooks actual y legacy, timestamps y payloads inválidos, y verifican la petición del SDK. CI añade una suite con PostgreSQL/NATS reales, los handlers de Orders/Inventory/Notifications y un gateway Polar de prueba. Verifica duplicados, publishers concurrentes, recuperación, éxito y compensación. El smoke histórico selecciona simulator explícitamente. La prueba con una organización Polar real requiere configurar las credenciales y URL pública descritos en [Orders](../../apps/orders-service/README.md).

Fuentes oficiales y fecha de consulta en [la documentación de Payments](../../apps/orders-service/README.md#documentación-oficial-verificada).
