# C4 nivel 2: contenedores de MercadoYa con Identity y Kong

Las cajas muestran las unidades de ejecución y el handler de Notifications. En local, el handler comparte el proceso del bridge. `inventory-v1` e `inventory-v2` son dos despliegues de la misma imagen. Orders incluye el worker Polar en el mismo proceso `:3002`. El bridge corre como proceso Node y puede invocar el handler local en ese proceso o una Function URL. Resend es un proveedor externo de correo.

```mermaid
flowchart LR
  buyer(["Comprador"])
  admin(["Admin"])
  subgraph system["MercadoYa actual"]
    web["Web host :5173<br/>shell, buyer y guard admin"]
    mf["MF catálogo admin :5174<br/>Module Federation ESM"]
    kong["Kong OSS 3.9.1 :8000"]
    identity["Identity :3006<br/>sesión Better Auth, JWT y JWKS"]
    catalog["Catalog/Media :3007<br/>CRUD, JWT y media"]
    orders["Orders :3002<br/>proceso Node y worker Polar"]
    inv1["Inventory v1 :3003<br/>compatibilidad HTTP y health"]
    inv2["Inventory v2 :3005<br/>default HTTP, reserva y compensación NATS"]
    bridge["Notifications bridge :3004<br/>consume desenlaces"]
    lambda["Notifications handler<br/>local o AWS Lambda<br/>React Email y cliente Resend"]
    db[("PostgreSQL :5432")]
    nats["NATS :4222"]
    uploads[("Disco local<br/>uploads")]
  end

  polar["Polar externo<br/>productos PEN y checkout"]
  resend["Resend externo<br/>correo a DEMO_NOTIFY_EMAIL"]

  buyer -->|HTTP| web
  admin -->|HTTP| web
  web -->|import async en /admin/products| mf
  web -->|HTTP y cookie| kong
  kong -->|Bearer JWT| orders
  kong -->|Bearer, v1 explícito| inv1
  kong -->|Bearer, v2 y alias| inv2
  kong -->|HTTP autorizado y health público| bridge
  kong -->|Catalog/Media y JWT| catalog
  kong -->|sesión y verificación| identity
  identity -->|tablas Identity y JWKS| db
  orders -->|SQL| db
  inv1 -->|SQL reservas| db
  inv2 -->|SQL reservas| db
  catalog -->|SQL| db
  catalog -->|imágenes| uploads
  catalog -->|JWKS| identity
  orders <-->|eventos| nats
  inv2 <-->|eventos| nats
  nats -->|payment.succeeded, payment.failed, inventory.rejected| bridge
  inv1 -->|JWKS| identity
  inv2 -->|stock con token S2S| catalog
  inv2 -->|JWKS| identity
  orders -->|JWKS| identity
  catalog -->|sync productos PEN| polar
  orders -->|crear checkout| polar
  buyer -->|pago en checkout| polar
  polar -->|webhook firmado| kong
  kong -->|webhook público| orders
  bridge -->|invoca con token| lambda
  lambda -->|HTML y texto si modo resend| resend
```

Compose publica `3005:3003` para v2. La base es compartida en esta demo. El slice federado ejecuta sus peticiones en el documento del host y comparte React/ReactDOM y UI. El handler no recibe NATS directamente. Inventory v2 consume `orders.placed` y `payment.failed`; v1 mantiene HTTP explícito y health. El worker consume `inventory.reserved`, crea el checkout Polar y publica el resultado del webhook firmado. Kong es el entrypoint y todos los servicios backend corren en Compose. Consulta [la secuencia de saga](seq-order-placed-fanout-v4.md).
