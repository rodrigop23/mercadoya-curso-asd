# 0021: Sincronización de Catalog con Polar y precios en PEN

Estado: aceptado. Fecha: 2026-10-01. Amplía [ADR 0019 de pagos](0019-polar-payments-saga.md).

## Decisión

Catalog es la fuente de título, descripción y precio de compra única. Su CRUD guarda el producto y una proyección pendiente en la misma transacción PostgreSQL. La tabla `catalog_polar_product` relaciona el UUID local con el UUID Polar por entorno, conserva versiones y sobrevive al borrado para archivar el producto remoto. Las imágenes siguen en Media y el stock lo reserva o libera Inventory a través de Catalog.

Un worker de Catalog procesa la proyección con advisory lock entre réplicas. Crea productos por API, actualiza texto y precios, y archiva al eliminar. Cada inicio incorpora los productos existentes. La metadata `mercadoya_product_id` permite encontrar un producto creado antes de perder la respuesta. Un POST incierto se recupera consultando esa metadata; no se repite sin comprobar que el anterior no creó el producto. Una edición durante la llamada deja una versión posterior pendiente.

El SDK oficial `@polar-sh/sdk@1.0.1`, API `2026-04`, admite PEN. El token de organización debe tener `products:write`, `organizations:write` y `checkouts:read/write`. El POST de productos omite `organization_id`, porque el OAT ya determina la organización y Polar rechaza ese campo con HTTP 422 `organization_token`. Catalog establece `default_presentment_currency=pen` en la organización antes de sincronizar. La organización debe ser la dedicada a MercadoYa porque esta preferencia afecta a su catálogo completo. El precio se expresa en céntimos de sol y se valida entre S/ 2.00 y S/ 999,999.99, según los límites Polar para precios fijos PEN. Los precios base usan impuestos exclusivos y el checkout presenta los impuestos aplicables.

Orders consulta `GET /api/internal/catalog/products/:id/billing` con `x-catalog-internal-token`. No lee tablas de Catalog ni usa un mapa de productos en env. Solo crea el pedido si el producto está sincronizado. Guarda su precio y UUID Polar en `orders_order.payment_product`; la reserva copia esos datos a su job de checkout. Una edición posterior no modifica el precio del pedido. El checkout solicita PEN explícitamente y usa el total unitario guardado por cantidad. El resultado del proveedor debe corresponder a ese importe y moneda antes de publicar `payment.succeeded`.

## Compatibilidad y límites

Los subjects y eventos `version: 1` de Orders, Inventory y Notifications se conservan. El DTO interno de billing es nuevo. `@mercadoya/contracts` y OpenAPI Orders pasan a `2.2.0`; OpenAPI Catalog pasa a `1.2.0`. La validación multipart y el formulario admin adoptan los límites PEN. Los productos históricos fuera del rango deben corregirse antes de admitir compras.

Las migraciones son aditivas y conservan el baseline, Identity y datos existentes. Los pedidos y enlaces ya abiertos conservan su moneda e importe originales; los pedidos nuevos usan PEN. Los pedidos antiguos sin precio guardado todavía pendientes de crear checkout fallan y compensan, en vez de inventar un precio.

La proyección persistente es un job de sincronización, sin publicar eventos de catálogo ni añadir outbox o JetStream. La saga mantiene las garantías y límites de NATS Core. Un producto pendiente devuelve 409 al intentar comprarlo antes de reservar stock; una caída de Catalog devuelve 503. Los fallos temporales tienen hasta cinco intentos por versión, persistidos antes de llamar a Polar, con esperas de 30, 60, 120 y 240 segundos. Un 429 puede ampliar la espera según `Retry-After`, hasta una hora. Los rechazos permanentes se detienen al primer intento. `next_attempt_at=NULL` detiene la programación y devuelve billing fallido, también para una creación incierta agotada. Los logs incluyen operación y estado HTTP, sin cuerpos ni secretos del SDK.

El comando `polar:retry` de Catalog reanuda registros detenidos por entorno y opcionalmente por UUID local. Usa el mismo lock del worker, conserva el UUID remoto y mantiene `creating` cuando el POST pudo haber terminado. Una edición de los datos de facturación empieza un presupuesto de intentos nuevo; un reinicio o un cambio de stock no lo reinicia. La migración `0002_polar_retry_limits` conserva los datos y reactiva una vez los errores programados del worker anterior.

## Validación

CI prueba el SDK con solicitudes de organización, creación sin `organization_id`, actualización, moneda PEN, errores seguros, precio total y firma de webhooks. PostgreSQL verifica transacciones, incorporación de productos existentes, edición durante creación, réplicas, respuesta perdida, reinicio, separación de entornos, archivado, backoff, límite de cinco intentos, detención de rechazos permanentes y reactivación sin duplicados. La saga integrada usa Catalog y su API HTTP interna reales, Orders, Inventory, Notifications, PostgreSQL y NATS. Verifica precio inmutable, éxito, fallo, expiración, anulación, duplicados y compensación. Polar se sustituye por un gateway de prueba; la compra real requiere credenciales sandbox y webhook público.

Documentación oficial consultada el 1 de octubre de 2026: [crear producto](https://polar.sh/docs/api-reference/products/create), [actualizar producto](https://polar.sh/docs/api-reference/products/update), [filtrar por metadata](https://polar.sh/docs/api-reference/2026-04/products/list-products), [monedas y precios](https://polar.sh/docs/features/products), [preferencias de organización](https://polar.sh/docs/api-reference/organizations/update), [SDK](https://polar.sh/docs/integrate/sdk/typescript) y [Checkout API](https://polar.sh/docs/api-reference/checkouts/create-session).
