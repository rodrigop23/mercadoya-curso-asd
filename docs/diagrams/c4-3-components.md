# C4 nivel 3: componentes de MercadoYa en S4 / V2

La API compone seis módulos en un proceso Hono. NATS conecta los handlers de eventos; Catalog no consume `orders.placed`.

```mermaid
flowchart LR
  subgraph mercadoya["MercadoYa · vista S4 / V2"]
    direction LR

    subgraph api["API Hono · un proceso Node"]
      direction TB
      composition["Composition root<br/>createApiLayer()"]
      identity["Identity<br/>auth, sesión y IdentityContract"]
      catalog["Catalog<br/>rutas y CatalogContract"]

      subgraph media["Media · MediaContract"]
        direction LR
        validate["Validate"] --> sanitize["Sanitize"] --> resize["Resize"] --> persist["Persist"] --> attach["Attach"]
      end

      orders["Orders<br/>crear pedido y actualizar estado"]
      inventory["Inventory<br/>reservar stock"]
      notifications["Notifications<br/>sender stub"]
      eventBus["EventBus adapter<br/>NATS o in-process"]
      eventsApi["Events API<br/>GET /api/events"]
      recent["Recent event store<br/>en memoria"]
    end

    postgres[("PostgreSQL<br/>una base compartida<br/>tablas propiedad de cada módulo")]
    uploads[("Disco local<br/>uploads/")]
    nats["NATS<br/>broker de Docker Compose"]
  end

  composition -->|crea y monta| identity
  composition -->|crea y monta| catalog
  composition -->|crea y monta| media
  composition -->|crea y monta| orders
  composition -->|crea y monta| inventory
  composition -->|crea y monta| notifications
  composition -->|registra handlers| eventBus

  catalog -->|IdentityContract: requireAdmin| identity
  catalog -->|MediaContract: processProductImage| media
  media -->|guarda imágenes| uploads

  identity -->|tablas de auth| postgres
  catalog -->|tabla product| postgres
  orders -->|tabla orders_order| postgres
  inventory -->|tabla inventory_reservations| postgres
  inventory -->|CatalogContract: getAvailableStock / adjustStock| catalog

  orders -->|publica orders.placed| eventBus
  eventBus -->|entrega inventory.reserved / inventory.rejected| orders
  eventBus -->|entrega orders.placed| inventory
  inventory -->|publica inventory.reserved / inventory.rejected| eventBus
  eventBus -->|entrega orders.placed e inventory.*| notifications
  eventBus <-->|publish / subscribe| nats

  eventBus -->|logEvent()| recent
  eventsApi -->|lee eventos recientes| recent
```

`apps/api/src/api-layer.ts` crea Identity, Catalog, Media, Orders, Inventory y Notifications en el mismo proceso. Inventory obtiene y ajusta el stock mediante `CatalogContract`; no importa las tablas de Catalog. Catalog no se suscribe a `orders.placed`.

Drizzle reúne los archivos `schema.ts` de los módulos en un cliente y una base PostgreSQL. Las tablas nuevas usan prefijos de módulo; Identity y Catalog conservan nombres anteriores como `user`, `session` y `product`. Notifications registra eventos mediante un stub y no envía correo.

La demo `cloud-pipeline-demo` no es un componente de la API. Se describe como sistema opcional en las vistas de contexto y contenedores.
