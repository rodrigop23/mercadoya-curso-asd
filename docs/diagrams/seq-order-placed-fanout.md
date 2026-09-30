# Secuencia S4 / V2: pedido y fan-out de `orders.placed` (histórico)

Documento histórico de una etapa anterior. No describe el despliegue actual ni debe usarse para iniciarlo. Consulta el [README actual](../../README.md) y el ADR 0020 sobre el retiro de la experiencia de eventos.

Esta secuencia corresponde a `v2-integration`. El flujo distribuido actual está en [la secuencia S5](seq-order-placed-fanout-v3.md).

Orders guarda el pedido como `pending` y publica `orders.placed`. Inventory consulta el stock mediante el contrato de Catalog. Notifications registra el pedido y el resultado con un sender stub.

```mermaid
sequenceDiagram
  actor Buyer as Comprador
  participant Web as Web SPA
  participant API as API Hono
  participant Orders
  participant DB as PostgreSQL
  participant Bus as EventBus
  participant NATS
  participant Inventory
  participant Catalog
  participant Notifications
  participant Log as Event log

  Buyer->>Web: Comprar en /catalog
  Web->>API: POST /api/orders
  API->>Orders: crear pedido
  Orders->>DB: INSERT orders_order (status: pending)
  DB-->>Orders: pedido creado
  Orders->>Bus: publicar orders.placed
  Bus->>NATS: publish orders.placed
  API-->>Web: 202 Accepted, pedido pending

  NATS-->>Inventory: orders.placed
  NATS-->>Notifications: orders.placed
  Notifications->>Log: sender stub registra recepción
  Inventory->>Catalog: CatalogContract getAvailableStock / adjustStock
  Catalog-->>Inventory: resultado de stock

  alt stock reservado
    Inventory->>Bus: publicar inventory.reserved
    Bus->>NATS: publish inventory.reserved
    NATS-->>Orders: inventory.reserved
    Orders->>DB: actualizar pedido a confirmed
    NATS-->>Notifications: inventory.reserved
    Notifications->>Log: sender stub registra confirmación
  else stock rechazado
    Inventory->>Bus: publicar inventory.rejected
    Bus->>NATS: publish inventory.rejected
    NATS-->>Orders: inventory.rejected
    Orders->>DB: actualizar pedido a rejected
    NATS-->>Notifications: inventory.rejected
    Notifications->>Log: sender stub registra rechazo
  end

  Web->>API: GET /api/orders/:orderId
  API->>DB: consultar estado del pedido
  DB-->>API: confirmed o rejected
  API-->>Web: estado actualizado
  Web->>API: GET /api/events?limit=100
  API->>Log: consultar eventos recientes
  Log-->>API: eventos del timeline
  API-->>Web: events
  Web-->>Buyer: muestra estado y timeline en /orders/$orderId
```

La vista `/events` consulta `GET /api/events`; el detalle `/orders/$orderId` consulta el estado del pedido y puede filtrar los eventos por `orderId`. La API conserva los eventos recientes en memoria. Notifications no envía correo. Catalog no se suscribe a `orders.placed`.
