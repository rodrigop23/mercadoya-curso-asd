# C4 nivel 3: componentes del API, Orders y Notifications con Identity y Kong

La vista abre Identity `:3006`, Orders `:3002` y Notifications, detrás de Kong `:8000`. El worker Polar comparte el proceso Orders. En local el bridge invoca el handler en su proceso; con Function URL, el handler corre en AWS Lambda.

```mermaid
flowchart LR
  web["Web host :5173<br/>buyer y shell admin"]
  mf["MF admin :5174<br/>UI de productos"]
  subgraph ordersProcess["Orders :3002, proceso Node"]
    orders["Rutas y servicio Orders<br/>pending, confirmed, rejected"]
    outcomes["Consumidores de desenlaces<br/>pago y resultados Inventory"]
    payments["Worker Polar<br/>checkout e inbox durable"]
    webhook["Webhook Polar<br/>firma Standard Webhooks"]
  end
  inventory["Inventory :3003"]
  subgraph notifications["Notifications, bridge local y handler local o Lambda"]
    bridge["Bridge :3004<br/>tres suscripciones de desenlace"]
    handler["Handler<br/>valida evento y registra resultado"]
    templates["React Email<br/>confirmado, rechazo stock y rechazo pago"]
    mail["Cliente Resend<br/>EMAIL_MODE, key, remitente y destinatario"]
  end
  nats["NATS :4222"]
  polar["Polar externo<br/>checkout y webhook"]
  resend["Resend externo"]
  db[("PostgreSQL :5432")]
  files[("uploads")]

  subgraph catalogProcess["Catalog/Media :3007"]
    catalog["Catalog<br/>CRUD y stock interno"]
    media["Media<br/>pipeline local"]
  end

  kong["Kong OSS :8000<br/>identity-auth"]
  identity["Identity :3006<br/>Better Auth, sesión, JWT y JWKS"]

  web -->|cookie| kong
  mf -->|cookie| kong
  kong -->|verificar sesión o JWT| identity
  kong -->|Bearer| orders
  kong -->|Bearer| inventory
  kong -->|HTTP autorizado| bridge
  kong -->|CRUD con Bearer| catalog
  catalog -->|JWKS para rol admin| identity
  orders -->|JWKS| identity
  inventory -->|JWKS| identity
  catalog -->|procesar imagen| media
  media --> files
  identity --> db
  catalog --> db
  orders -->|SQL pedido| db
  inventory -->|SQL reservas| db
  inventory -->|stock con token S2S| catalog
  nats -->|orders.placed, payment.failed| inventory
  inventory -->|inventory.reserved, inventory.rejected, inventory.released| nats
  orders -->|orders.placed| nats
  nats -->|inventory.reserved| payments
  payments -->|crear checkout| polar
  polar -->|webhook firmado por Kong| webhook
  webhook -->|inbox PostgreSQL| payments
  payments -->|payment.succeeded o payment.failed| nats
  catalog -->|sync productos PEN| polar
  nats -->|payment.succeeded, payment.failed, inventory.rejected, inventory.released| outcomes
  outcomes --> orders
  nats -->|payment.succeeded, payment.failed, inventory.rejected| bridge
  bridge -->|x-invoke-token| handler
  handler --> templates
  templates -->|HTML y texto| mail
  handler --> mail
  mail -->|envío si modo resend| resend
```

Kong verifica la cookie o JWT con Identity; Orders e Inventory verifican firma y claims JWT mediante JWKS. Inventory usa rutas internas de Catalog con `x-catalog-internal-token`. El handler de Notifications registra en logs `emailStatus` igual a `stub`, `sent` o `error`. Usa siempre `DEMO_NOTIFY_EMAIL`; no busca emails por `buyerId`. La compensación de Inventory y el correo por pago fallido son independientes. Consulta [ADR 0017](../adr/0017-identity-kong-jwks.md), [ADR 0015](../adr/0015-saga-coreografia-compensacion.md) y [ADR 0011](../adr/0011-notifications-lambda-bridge.md).
