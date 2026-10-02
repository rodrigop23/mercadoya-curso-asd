# ADR 0008: un contrato y un despliegue de Inventory

## Estado

Aceptada. Actualizada por el prompt 11. El ejercicio de versiones simultáneas permanece en la rama `v3-services`.

## Decisión

Inventory ejecuta un único contenedor `inventory` en `:3003`. Kong publica `/api/inventory/health` y `/api/inventory/reservations/:orderId`. La lectura mantiene el contrato vigente, que exige `reservation.status: "reserved"`. No se mantienen rutas HTTP versionadas, DTO antiguos ni headers de deprecación o de versión del proceso.

Inventory es el único dueño de reserva y compensación. Registra un handler para `orders.placed` y uno para `payment.failed`. Los subjects NATS y sus schemas con `version: 1` conservan su contrato.

## Consecuencias

Los clientes usan la ruta sin versión. Contracts sube a `3.0.0` por retirar exports antiguos y OpenAPI Inventory a `5.0.0` por retirar rutas. La spec se regenera desde Zod y metadatos; no se edita a mano. Las pruebas verifican que las rutas retiradas respondan 404, que el DTO exija status y que el runtime registre ambas suscripciones una sola vez.

El cutover detiene los contenedores anteriores antes de arrancar el único Inventory. NATS Core no retiene eventos durante esa pausa. El procedimiento está en [Inventory](../../apps/inventory-service/README.md).
