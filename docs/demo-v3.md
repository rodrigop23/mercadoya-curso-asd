# Demo de servicios y saga

Esta guía usa el despliegue actual. Las etapas anteriores permanecen en el historial Git.

1. Copia `.env.example` a `.env` y configura los secretos de Identity, Catalog y Notifications, y las [credenciales de Polar sandbox](../apps/orders-service/README.md).
2. Ejecuta `pnpm install`, `pnpm demo:infra` y `pnpm dev`.
3. Abre `http://localhost:5173`, registra un usuario y sigue la [guía de autenticación y admin](../README.md#autenticación-local).
4. Publica un producto desde `/admin/products`, espera su sincronización Polar y compra desde `/catalog`. Completa el checkout Polar sandbox. `/orders/<orderId>` muestra el estado actual y el resumen del pedido.
5. Revisa `docker compose logs notifications` para el desenlace y su `emailStatus`. En modo Resend comprueba también el correo configurado en `DEMO_NOTIFY_EMAIL`.
6. Ejecuta `pnpm demo:saga` con un producto de clase y stock suficiente. El CLI comprueba rechazo por stock, muestra un checkout real y espera su webhook. La suite `polar-saga` comprueba compensación y duplicados. Crea pedidos persistentes y consume una unidad en el caso exitoso.

Kong en `:8000` enruta Identity, Catalog/Media, Orders, un único Inventory `:3003` y Notifications. Inventory expone el contrato vigente en `/api/inventory/*`; la comparación de versiones permanece en la rama `v3-services`. Consulta los [puertos y comandos actuales](../README.md), la [guía de saga](../scripts/README.md) y la [secuencia NATS](diagrams/seq-order-placed-fanout-v4.md).

NATS Core no reproduce eventos ni ofrece reintento duradero. Orders usa exclusivamente Polar. El ejercicio histórico permanece en el rama `v3-services`. Notifications conserva los tres subjects de desenlace y los templates existentes.
