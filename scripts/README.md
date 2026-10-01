# Demo de saga con Polar

Configura [Polar sandbox, catálogo PEN y webhook público](../apps/orders-service/README.md). Ejecuta `pnpm demo:infra` y `pnpm dev`. Crea un producto dedicado con stock y espera su sincronización con Polar.

Desde la raíz ejecuta:

```sh
pnpm demo:saga
# Selecciona un producto concreto.
DEMO_PRODUCT_ID=<uuid> pnpm demo:saga
```

El CLI carga `.env`, usa `CATALOG_URL`, `CATALOG_INTERNAL_TOKEN` y `GATEWAY_URL`, crea un usuario local y envía los pedidos por Kong. Comprueba primero el rechazo por stock insuficiente sin modificar existencias. Después crea un pedido de una unidad, imprime su checkout Polar sandbox y espera hasta diez minutos el webhook firmado. Abre el enlace y completa el pago. Una confirmación consume una unidad; un resultado rechazado comprueba que Inventory restaure el stock. Usa un producto sin compras concurrentes para que la comparación de existencias sea válida.

El CLI deja el usuario y los pedidos persistentes. Si termina por timeout, consulta el pedido antes de repetirlo; su checkout puede seguir abierto y mantener la reserva. Cerrar el navegador no equivale a un fallo de pago. Para compensar, deja expirar el checkout o anula la orden desde Polar sandbox y espera el webhook.

La suite `polar-saga` de CI verifica éxito, fallo, expiración, anulación, compensación, duplicados, reinicios e idempotencia con PostgreSQL/NATS reales y gateways exclusivos de prueba. Usa el handler real de Notifications en modo stub y no necesita credenciales Polar.

El ejercicio histórico permanece en el rama `v3-services`.
