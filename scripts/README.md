# Demo de saga

Prepara `.env` como indica el README raíz, ejecuta `pnpm demo:infra` y deja `pnpm dev` activo. Se requieren PostgreSQL, NATS, Catalog/Media, Orders e Inventory v2 actualizado. El simulador arranca con Orders. No hay un proceso de pagos separado.

Crea desde la UI admin un producto de clase con al menos dos unidades. Después ejecuta desde la raíz:

```sh
pnpm demo:saga
# Opcional: selecciona un producto concreto.
DEMO_PRODUCT_ID=<uuid> pnpm demo:saga
```

El script `apps/orders-service/src/demo-saga.ts` usa `DATABASE_URL`, `NATS_URL`, `CATALOG_URL`, `CATALOG_INTERNAL_TOKEN` y `GATEWAY_URL` de `.env`. Crea un usuario local de demo y obtiene una cookie para crear pedidos por Kong y consultar reservas v2. El escenario de pago fallido usa el servicio interno con `buyerId: null` porque el override de pago no está disponible en el POST público. Usa `CATALOG_URL=http://localhost:3007` solo para productos/stock y `GATEWAY_URL=http://localhost:8000` para Identity, Orders e Inventory. Observa eventos antes de crear pedidos.

El CLI elige el primer producto con stock suficiente si no defines `DEMO_PRODUCT_ID`. Usa un producto dedicado y evita compras simultáneas durante la prueba, porque compara stock antes y después. Crea un usuario local y tres pedidos persistentes; el caso exitoso consume una unidad. No elimina pedidos ni repone esa unidad.

Comprueba ambos healthchecks, las secuencias y el estado consultando `GET /api/orders/:id`. Verifica reservas por `/api/inventory/v2/reservations/:id` y por el alias sin versión: `X-Service-Version: v2`, `reservation.status: "reserved"` al confirmar y `404` al rechazar o compensar. No consulta reservas v1.

- Pago OK: `orders.placed`, `inventory.reserved`, `payment.succeeded`; estado `confirmed` y una unidad menos.
- Stock insuficiente: solicita una unidad más que el stock disponible; `inventory.rejected`, estado `rejected`, sin pago ni liberación.
- Pago fallido: fuerza `paymentMode=fail` después de reservar; `payment.failed`, `inventory.released`, estado `rejected` y stock restaurado.

Finalmente publica dos fallos duplicados y comprueba que el stock sigue igual y solo hubo una liberación. Cada escenario tiene un timeout de 15 segundos; un resultado incorrecto termina con código distinto de cero. La salida muestra IDs, secuencias y stock. Puedes acompañarla con `docker compose logs -f inventory-v2`.

Para forzar fallos desde la UI, cambia `PAYMENT_MODE=fail` en `.env` y reinicia Orders. Devuelve la variable a `succeed` después de la clase. El override del CLI permite probar ambos caminos en la misma ejecución.
