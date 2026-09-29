# Secuencia S5: compra con Orders, Inventory y Notifications

Solo Inventory v1 consume `orders.placed`. Inventory v2 ofrece lectura HTTP de la reserva y no vuelve a procesar el pedido.

```mermaid
sequenceDiagram
  actor Buyer as Comprador
  participant Web as Web host :5173
  participant API as API gateway :3001
  participant Orders as Orders :3002
  participant DB as PostgreSQL :5432
  participant NATS as NATS :4222
  participant Inv as Inventory v1 :3003
  participant Catalog as Catalog interno :3001
  participant Bridge as Bridge :3004
  participant Handler as Handler local o Lambda
  participant Timeline as Events en API

  Buyer->>Web: compra en /catalog
  Web->>API: POST /api/orders con cookie
  API->>Orders: proxy POST /api/orders
  Orders->>API: GET /api/me con cookie
  API-->>Orders: sesión de comprador
  Orders->>DB: INSERT pedido pending
  Orders->>NATS: publish orders.placed version 1
  Orders-->>API: 202 pedido pending
  API-->>Web: 202 pedido pending
  NATS-->>Inv: orders.placed
  NATS-->>Bridge: orders.placed
  Bridge->>Handler: invoca con x-invoke-token
  Handler->>Timeline: POST /api/events/ingest con x-ingest-token
  Inv->>Catalog: stock HTTP con x-catalog-internal-token
  Catalog-->>Inv: ajuste de stock o rechazo
  alt stock reservado
    Inv->>DB: guarda reserva
    Inv->>NATS: publish inventory.reserved version 1
    NATS-->>Orders: inventory.reserved
    Orders->>DB: UPDATE pedido confirmed
    NATS-->>Bridge: inventory.reserved
  else stock rechazado
    Inv->>NATS: publish inventory.rejected version 1
    NATS-->>Orders: inventory.rejected
    Orders->>DB: UPDATE pedido rejected
    NATS-->>Bridge: inventory.rejected
  end
  Bridge->>Handler: invoca resultado con x-invoke-token
  Handler->>Timeline: POST /api/events/ingest con x-ingest-token
  Web->>API: GET /api/orders/:orderId
  API->>Orders: proxy de estado
  Orders-->>API: estado del pedido
  API-->>Web: estado del pedido
  Web->>Timeline: GET /api/events?orderId=...
  Timeline-->>Web: notificaciones recientes
```

El buffer de Events es local al API y no da persistencia de notificaciones. NATS y la actualización del pedido son asíncronos.
