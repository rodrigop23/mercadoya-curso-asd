# Secuencia actual: saga de pedido, compensación y email

Esta secuencia incorpora Identity propio y Kong del prompt 04. Solo Inventory v2 procesa los eventos de reserva y compensación; v1 conserva HTTP explícito y health. El participante de pago es un componente del mismo proceso Orders `:3002`.

```mermaid
sequenceDiagram
  actor Buyer as Comprador
  participant Web as Web host :5173
  participant API as Kong OSS :8000
  participant Identity as Identity :3006
  participant Orders as Orders :3002
  participant Payment as Simulador dentro de Orders :3002
  participant DB as PostgreSQL :5432
  participant NATS as NATS :4222
  participant Inv as Inventory v2 :3005
  participant Catalog as Catalog interno :3001
  participant Bridge as Bridge :3004
  participant Handler as Handler local o Lambda
  participant Resend as Resend externo
  participant Timeline as Events en API :3001

  Buyer->>Web: compra en /catalog
  Web->>API: POST /api/orders con cookie
  API->>Identity: verificar sesión persistida y emitir JWT
  Identity-->>API: JWT RS256 con sub, role, iss, aud y kid
  API->>Orders: POST /api/orders con Bearer JWT
  Orders->>Identity: JWKS público si no está cacheado
  Identity-->>Orders: claves públicas
  Orders->>Orders: verificar firma y claims; buyerId = sub
  Orders->>DB: INSERT pedido pending
  Orders->>NATS: publish orders.placed version 1
  Note over Orders,NATS: paymentMode opcional solo desde CLI interno
  Orders-->>API: 202 pedido pending
  API-->>Web: 202 pedido pending
  NATS-->>Inv: orders.placed
  Inv->>Catalog: consultar y ajustar stock con token interno
  Catalog-->>Inv: ajuste de stock o rechazo
  alt stock rechazado
    Inv->>NATS: publish inventory.rejected
    par rechazo de pedido
      NATS-->>Orders: inventory.rejected
      Orders->>DB: UPDATE pedido rejected
    and correo de stock
      NATS-->>Bridge: inventory.rejected
      Bridge->>Handler: invoca template order-rejected-stock con x-invoke-token
    end
    Note over Inv,Payment: No hay reserva ni pago
  else stock reservado
    Inv->>DB: guarda reserva
    Inv->>NATS: publish inventory.reserved con paymentMode opcional
    NATS-->>Payment: inventory.reserved
    Note over Orders,Payment: El pedido sigue pending hasta el desenlace del pago
    alt pago exitoso
      Payment->>NATS: publish payment.succeeded
      par confirmación de pedido
        NATS-->>Orders: payment.succeeded
        Orders->>DB: UPDATE pedido confirmed
      and correo de confirmación
        NATS-->>Bridge: payment.succeeded
        Bridge->>Handler: invoca template order-confirmed con x-invoke-token
      end
    else pago fallido
      Payment->>NATS: publish payment.failed
      par rechazo de pedido
        NATS-->>Orders: payment.failed
        Orders->>DB: UPDATE pedido rejected
      and compensación de stock
        NATS-->>Inv: payment.failed
        Inv->>DB: lock por orderId y consulta de reserva
        Inv->>Catalog: restaurar cantidad con token interno
        Catalog-->>Inv: stock restaurado
        Inv->>DB: elimina reserva y commit
        Inv->>NATS: publish inventory.released
        NATS-->>Orders: inventory.released
        Orders->>DB: registra rejected si el estado permite la transición
      and correo de pago fallido
        NATS-->>Bridge: payment.failed
        Bridge->>Handler: invoca template order-rejected-payment con x-invoke-token
      end
    end
  end
  Note over Bridge,Handler: Solo se invoca por los tres desenlaces
  Handler->>Handler: valida evento y renderiza HTML y texto con React Email
  alt modo Resend y destinatario configurado
    Handler->>Resend: enviar desde RESEND_FROM a DEMO_NOTIFY_EMAIL
    Resend-->>Handler: aceptación o error de envío
    Handler->>Timeline: ingest notification.email con emailStatus sent o error
  else modo stub o destinatario ausente
    Handler->>Timeline: ingest notification.stub con emailStatus stub
  end
  Note over Handler,Timeline: POST /api/events/ingest con x-ingest-token
  Web->>API: GET /api/orders/:orderId con cookie
  API->>Identity: verificar sesión y emitir JWT
  Identity-->>API: JWT
  API->>Orders: GET de estado con Bearer
  Orders->>Orders: verificar JWT
  Orders-->>API: estado del pedido
  API-->>Web: estado del pedido
  Web->>API: GET /api/events?orderId=... con cookie
  API->>Identity: verificar sesión
  Identity-->>API: JWT
  API->>Timeline: GET autenticado
  Timeline-->>API: notificaciones recientes
  API-->>Web: notificaciones recientes
```

Los consumidores de cada desenlace avanzan en paralelo. El correo de pago fallido y el estado `rejected` no esperan `inventory.released`. Un fallo duplicado no repone stock tras una liberación completada; si no hay reserva, Inventory no publica otra liberación. El bridge no consume `orders.placed`, `inventory.reserved` ni `inventory.released`.

`PAYMENT_MODE` define el resultado por defecto; el override del CLI tiene prioridad. `EMAIL_MODE` vacío usa Resend si existe `RESEND_API_KEY` y stub si no existe; `stub` fuerza simulación. Todos los correos usan `DEMO_NOTIFY_EMAIL`, sin lookup por `buyerId`. `sent` significa aceptación por Resend. El ingest y el envío no son atómicos, la timeline se pierde al reiniciar el API y NATS Core no reproduce eventos perdidos.

Consulta [ADR 0015](../adr/0015-saga-coreografia-compensacion.md), [ADR 0011](../adr/0011-notifications-lambda-bridge.md), [la guía de saga](../../scripts/README.md) y [la configuración de Notifications](../../apps/notifications-lambda/README.md).
