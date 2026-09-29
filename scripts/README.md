# Demo de saga

Prepara `.env` como indica el README raíz, ejecuta `pnpm demo:infra` y deja `pnpm dev` activo. Se requieren PostgreSQL, NATS, API/Catalog, Orders e Inventory v1 actualizado. El simulador arranca con Orders. No hay un proceso de pagos separado.

Crea desde la UI admin un producto de clase con al menos dos unidades. Después ejecuta desde la raíz:

```sh
pnpm demo:saga
# Opcional: selecciona un producto concreto.
DEMO_PRODUCT_ID=<uuid> pnpm demo:saga
```

El script `apps/orders-service/src/demo-saga.ts` usa `DATABASE_URL`, `NATS_URL`, `CATALOG_URL`, `CATALOG_INTERNAL_TOKEN` y `ORDERS_SERVICE_URL` de `.env`. No necesita credenciales de comprador ni cookie: llama al servicio interno de Orders, guarda pedidos con `buyerId: null` y observa los eventos antes de crearlos. `POST /api/orders` sigue exigiendo sesión.

El CLI elige el primer producto con stock suficiente si no defines `DEMO_PRODUCT_ID`. Usa un producto dedicado y evita compras simultáneas durante la prueba, porque compara stock antes y después. Crea tres pedidos persistentes; el caso exitoso consume una unidad. No elimina pedidos ni repone esa unidad.

Comprueba las secuencias y el estado consultando `GET /api/orders/:id`:

- Pago OK: `orders.placed`, `inventory.reserved`, `payment.succeeded`; estado `confirmed` y una unidad menos.
- Stock insuficiente: solicita una unidad más que el stock disponible; `inventory.rejected`, estado `rejected`, sin pago ni liberación.
- Pago fallido: fuerza `paymentMode=fail` después de reservar; `payment.failed`, `inventory.released`, estado `rejected` y stock restaurado.

Finalmente publica dos fallos duplicados y comprueba que el stock sigue igual y solo hubo una liberación. Cada escenario tiene un timeout de 15 segundos; un resultado incorrecto termina con código distinto de cero. La salida muestra IDs, secuencias y stock. Puedes acompañarla con `docker compose logs -f inventory-v1`.

Para forzar fallos desde la UI, cambia `PAYMENT_MODE=fail` en `.env` y reinicia Orders. Devuelve la variable a `succeed` después de la clase. El override del CLI permite probar ambos caminos en la misma ejecución.
