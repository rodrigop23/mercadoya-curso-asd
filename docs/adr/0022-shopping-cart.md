# 0022: Carrito y pedido de varias líneas sobre la saga existente

Estado: aceptado. Fecha: 2026-10-02. Amplía [ADR 0019](0019-polar-payments-saga.md) y [ADR 0021](0021-polar-catalog-sync-pen.md).

## Decisión

El carrito pertenece a la web y persiste en el navegador por comprador. El catálogo solo agrega productos o cambia cantidades. `/cart` muestra las líneas, subtotales y total, y crea una orden cuando el comprador pulsa pagar. La cabecera comparte el estado del carrito con ambas páginas. No se añade otro servicio ni una tabla de carritos.

Orders acepta el cuerpo histórico `productId/quantity` y un cuerpo nuevo `items`. Guarda las líneas con título, miniatura, cantidad, precio unitario PEN y relación Polar obtenidos de Catalog. La respuesta pública omite la relación Polar. Una clave UUID de reintento identifica el pedido y evita crear otra orden cuando se pierde la respuesta. Reutilizarla exige el mismo comprador y las mismas líneas.

Los campos históricos de producto y cantidad se conservan como primera línea para los pedidos anteriores. Las migraciones añaden snapshots JSON y estado de preparación del producto de pago. Los eventos conservan subjects y `version: 1`, con `items` opcional. Esto conserva las compras anteriores, pero exige actualizar juntos los consumidores antes de habilitar carritos: un consumidor anterior no sabe reservar las líneas adicionales.

Inventory mantiene su responsabilidad de reserva y compensación. Para un carrito solicita a Catalog un ajuste de stock completo. Catalog bloquea los productos en orden, valida todas las cantidades y aplica todos los ajustes en una transacción. Una tabla de operaciones guarda una clave por pedido y acción para recuperar respuestas perdidas sin volver a descontar o restaurar stock. Las reservas liberadas de carrito permanecen marcadas para impedir una nueva reserva por un evento tardío.

Polar ofrece productos alternativos en `products`, sin sumar sus precios. Orders reutiliza un producto privado de compra única llamado `Compra en MercadoYa`. Su precio de catálogo es variable y cada checkout fija un precio ad-hoc con el total guardado, sin descuentos ni trials. Polar muestra el nombre genérico y el importe; MercadoYa conserva el desglose en el pedido. No se cambia el nombre, descripción ni precio de catálogo al procesar una compra.

La migración aditiva `0004_purchase_product` guarda una única referencia por entorno en `orders_payment_product`. El lock del worker serializa su preparación entre pedidos y réplicas. Orders busca primero por `mercadoya_checkout=purchase`, guarda `creating` antes de crear el producto y conserva `ready` con su ID. Una respuesta perdida o 5xx solo permite buscar la creación anterior, también después de reiniciar. Cada pedido sigue registrando la intención de crear su checkout y lo recupera por `order_id`, sin repetir un POST incierto. Los checkouts anteriores conservan su producto; las creaciones antiguas pendientes se recuperan por `mercadoya_order_id`. El éxito vuelve a `/orders/:id`; regresar sin pagar vuelve a `/cart` y conserva el enlace para continuar.

Solo un webhook firmado con checkout, importe y moneda coincidentes confirma el pago. La web limpia el carrito al recibir esa confirmación. El carrito y el pedido usan miniaturas. Ante una imagen histórica sin miniatura o un archivo eliminado, muestran un marcador sin recurrir a la imagen full. El snapshot conserva la ruta y el texto, no duplica los bytes de Media.

## Límites

El carrito tiene hasta 20 productos distintos y usa los límites existentes de cantidad e importe. Persiste en este navegador, sin sincronización entre dispositivos. Durante un pago abierto sus cantidades quedan reservadas; volver de Polar no libera stock ni acredita el cobro. Se conserva el límite operativo de las creaciones inciertas y las garantías de NATS Core descritos en ADR 0019. Un operador debe comprobar una creación que no puede encontrarse antes de reactivarla.

Los productos privados de pedido anteriores permanecen en Polar. No se archivan antes del pago, porque dejarían de admitir checkout. Su eliminación administrativa o archivado posterior queda fuera de este cambio. El producto compartido pertenece a la organización configurada para cada entorno, igual que la sincronización de Catalog. Un cambio de organización requiere revisar esas referencias. Los impuestos siguen siendo exclusivos y Polar presenta los aplicables al pagar. El total guardado y validado es el subtotal de productos.

## Validación

Las pruebas de contratos conservan cuerpos y eventos anteriores y validan líneas distintas y cantidades. El SDK se prueba con el producto privado genérico, precios ad-hoc de importes distintos, moneda, URLs y recuperación por metadata. La saga con PostgreSQL y NATS reales verifica reserva completa, falta de stock, compensación de todas las líneas, concurrencia, duplicados, snapshots, reutilización tras reiniciar, separación por entorno y recuperación tras perder la respuesta de creación. También conserva productos de pedido anteriores. Las pruebas de navegador cubren controles, persistencia, separación de compradores, miniaturas, totales, redirecciones y pedidos anteriores. Polar se sustituye por fixtures; el cobro real requiere una organización sandbox y webhook público.

Fuentes oficiales consultadas el 2 y 3 de octubre de 2026: [Checkout API y precios ad-hoc](https://polar.sh/docs/features/checkout/session), [crear producto](https://polar.sh/docs/api-reference/2026-04/products/create-product) y [validación de visibilidad en Polar](https://github.com/polarsource/polar/blob/main/server/polar/checkout/service.py).
