# C4 nivel 3: componentes del API, Orders y Notifications en S5 / v3-services

Documento histórico de una etapa anterior. No describe el despliegue actual ni debe usarse para iniciarlo. Consulta el [README actual](../../README.md) y el ADR 0020 sobre el retiro de la experiencia de eventos.

La vista abre el API `:3001`, Orders `:3002` y Notifications. El simulador comparte el proceso Orders. En local el bridge invoca el handler en su proceso; con Function URL, el handler corre en AWS Lambda.

```mermaid
flowchart LR
  web["Web host :5173<br/>buyer y shell admin"]
  mf["MF admin :5174<br/>UI de productos"]
  subgraph ordersProcess["Orders :3002, proceso Node"]
    orders["Rutas y servicio Orders<br/>pending, confirmed, rejected"]
    outcomes["Consumidores de desenlaces<br/>pago y resultados Inventory"]
    simulator["Simulador de pago<br/>PAYMENT_MODE y override del evento"]
  end
  inv1["Inventory v1 :3003"]
  inv2["Inventory v2 :3005"]
  subgraph notifications["Notifications, bridge local y handler local o Lambda"]
    bridge["Bridge :3004<br/>tres suscripciones de desenlace"]
    handler["Handler<br/>valida evento y registra resultado"]
    templates["React Email<br/>confirmado, rechazo stock y rechazo pago"]
    mail["Cliente Resend<br/>EMAIL_MODE, key, remitente y destinatario"]
  end
  nats["NATS :4222"]
  resend["Resend externo"]
  db[("PostgreSQL :5432")]
  files[("uploads")]

  subgraph api["API gateway/BFF :3001"]
    identity["Identity<br/>/api/auth y /api/me"]
    catalog["Catalog<br/>/api/products e internal stock"]
    media["Media<br/>/api/media y pipeline"]
    proxyOrders["Proxy /api/orders"]
    proxyInventory["Proxy /api/inventory<br/>v1, v2 y alias"]
    proxyNotifications["Proxy /api/notifications"]
    events["Events<br/>GET /api/events<br/>POST /api/events/ingest"]
    recent["Buffer reciente en memoria"]
  end

  web -->|cookie| identity
  web -->|HTTP| catalog
  web -->|HTTP| proxyOrders
  web -->|HTTP| proxyInventory
  web -->|timeline| events
  mf -->|cookie, CRUD| catalog
  mf -->|rol| identity
  catalog -->|requireAdmin| identity
  catalog -->|procesar imagen| media
  media --> files
  identity --> db
  catalog --> db
  proxyOrders --> orders
  proxyInventory -->|v1 explícito| inv1
  proxyInventory -->|v2 y alias default| inv2
  proxyNotifications --> bridge
  events --> recent
  orders -->|SQL pedido| db
  orders -->|orders.placed| nats
  nats -->|inventory.reserved| simulator
  simulator -->|payment.succeeded o payment.failed| nats
  nats -->|payment.succeeded, payment.failed, inventory.rejected, inventory.released| outcomes
  outcomes --> orders
  nats -->|payment.succeeded, payment.failed, inventory.rejected| bridge
  bridge -->|x-invoke-token| handler
  handler --> templates
  templates -->|HTML y texto| mail
  handler --> mail
  mail -->|envío si modo resend| resend
  handler -->|notification.stub o notification.email, x-ingest-token| events
```

Orders e Inventory consultan `GET /api/me` para validar la cookie recibida. Inventory v2 usa rutas internas de Catalog con `x-catalog-internal-token`. El handler de Notifications escribe en Events con `x-ingest-token` y `emailStatus` igual a `stub`, `sent` o `error`. Usa siempre `DEMO_NOTIFY_EMAIL`; no busca emails por `buyerId`. La compensación de Inventory y el correo por pago fallido son independientes. Consulta [ADR 0015](../adr/0015-saga-coreografia-compensacion.md) y [ADR 0011](../adr/0011-notifications-lambda-bridge.md).
