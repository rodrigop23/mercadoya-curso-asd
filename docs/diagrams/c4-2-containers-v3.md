# C4 nivel 2: contenedores de MercadoYa en S5 / v3-services

Las cajas muestran las unidades de ejecución y el handler de Notifications. En local, el handler comparte el proceso del bridge. `inventory-v1` e `inventory-v2` son dos despliegues de la misma imagen. Orders incluye el simulador de pago en el mismo proceso `:3002`. El bridge corre como proceso Node y puede invocar el handler local en ese proceso o una Function URL. Resend es un proveedor externo de correo.

```mermaid
flowchart LR
  buyer(["Comprador"])
  admin(["Admin"])
  subgraph system["MercadoYa S5"]
    web["Web host :5173<br/>shell, buyer y guard admin"]
    mf["MF catálogo admin :5174<br/>iframe y postMessage"]
    api["API gateway/BFF :3001<br/>Identity, Catalog, Media y events"]
    orders["Orders :3002<br/>proceso Node y simulador de pago"]
    inv1["Inventory v1 :3003<br/>contenedor, reserva y compensación NATS"]
    inv2["Inventory v2 :3005<br/>contenedor, solo HTTP"]
    bridge["Notifications bridge :3004<br/>consume desenlaces"]
    lambda["Notifications handler<br/>local o AWS Lambda<br/>React Email y cliente Resend"]
    db[("PostgreSQL :5432")]
    nats["NATS :4222"]
    uploads[("Disco local<br/>uploads")]
  end

  resend["Resend externo<br/>correo a DEMO_NOTIFY_EMAIL"]

  buyer -->|HTTP| web
  admin -->|HTTP| web
  web -->|iframe en /admin/products| mf
  web -->|HTTP y cookie| api
  mf -->|Catalog HTTP y cookie| api
  api -->|proxy HTTP| orders
  api -->|proxy /v1 y alias| inv1
  api -->|proxy /v2| inv2
  api -->|proxy health| bridge
  orders -->|SQL| db
  inv1 -->|SQL reservas| db
  inv2 -->|SQL reservas| db
  api -->|SQL| db
  api -->|imágenes| uploads
  orders <-->|eventos| nats
  inv1 <-->|eventos| nats
  nats -->|payment.succeeded, payment.failed, inventory.rejected| bridge
  inv1 -->|Catalog interno y /api/me| api
  inv2 -->|/api/me| api
  orders -->|/api/me| api
  bridge -->|invoca con token| lambda
  lambda -->|HTML y texto si modo resend| resend
  lambda -->|ingest notification.stub o notification.email| api
```

Compose publica `3005:3003` para v2. La base es compartida en esta demo. `postMessage` solo comunica la altura del iframe al host. El handler no recibe NATS directamente. Inventory v1 consume `orders.placed` y `payment.failed`; v2 mantiene solo HTTP. El simulador consume `inventory.reserved` y publica el resultado del pago. El BFF Hono es el entrypoint; Kong queda fuera de Compose y del laboratorio. Consulta [la secuencia de saga](seq-order-placed-fanout-v3.md).
