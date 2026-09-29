# C4 nivel 3: componentes del API en S5 / v3-services

La vista abre solo el proceso API `:3001`. Orders, Inventory, bridge y MF son procesos externos a esa caja.

```mermaid
flowchart LR
  web["Web host :5173<br/>buyer y shell admin"]
  mf["MF admin :5174<br/>UI de productos"]
  orders["Orders :3002"]
  inv1["Inventory v1 :3003"]
  inv2["Inventory v2 :3005"]
  bridge["Bridge :3004"]
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
  proxyInventory --> inv1
  proxyInventory --> inv2
  proxyNotifications --> bridge
  events --> recent
```

Orders e Inventory consultan `GET /api/me` para validar la cookie recibida. Inventory v1 usa rutas internas de Catalog con `x-catalog-internal-token`. El handler de Notifications escribe en Events con `x-ingest-token`.
