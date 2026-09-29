# C4 nivel 2: contenedores de MercadoYa en S5 / v3-services

Las cajas representan unidades de ejecución. `inventory-v1` e `inventory-v2` son dos despliegues de la misma imagen. El bridge corre como proceso Node y puede invocar el handler local o una Function URL.

```mermaid
flowchart LR
  buyer(["Comprador"])
  admin(["Admin"])
  subgraph system["MercadoYa S5"]
    web["Web host :5173<br/>shell, buyer y guard admin"]
    mf["MF catálogo admin :5174<br/>iframe y postMessage"]
    api["API gateway/BFF :3001<br/>Identity, Catalog, Media y events"]
    orders["Orders :3002<br/>proceso Node"]
    inv1["Inventory v1 :3003<br/>contenedor, consume orders.placed"]
    inv2["Inventory v2 :3005<br/>contenedor, solo HTTP"]
    bridge["Notifications bridge :3004<br/>proceso Node"]
    lambda["Notifications handler<br/>local o AWS Lambda Function URL"]
    db[("PostgreSQL :5432")]
    nats["NATS :4222"]
    uploads[("Disco local<br/>uploads")]
  end

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
  bridge -->|consume eventos| nats
  inv1 -->|Catalog interno y /api/me| api
  inv2 -->|/api/me| api
  orders -->|/api/me| api
  bridge -->|invoca con token| lambda
  lambda -->|POST /api/events/ingest| api
```

Compose publica `3005:3003` para v2. La base es compartida en esta demo. `postMessage` solo comunica la altura del iframe al host. El handler no recibe NATS directamente.
