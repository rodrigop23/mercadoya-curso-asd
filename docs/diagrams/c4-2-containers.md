# C4 nivel 2 — Containers

Vista de ejecución de MercadoYa. En desarrollo, la SPA está en `:5173` y la API en `:3001`.

```mermaid
flowchart LR
  browser(["Comprador / Admin<br/>Navegador"])

  subgraph mercadoya["Sistema MercadoYa"]
    direction LR
    web["Web SPA<br/>@mercadoya/web<br/>Vite + React · :5173"]
    api["API monolítica<br/>@mercadoya/api<br/>Hono · :3001"]
    postgres[("PostgreSQL<br/>Base de datos")]
    uploads[("Disco local<br/>apps/api/uploads/")]
  end

  browser -->|"carga la SPA · HTTP :5173"| web
  web -->|"la SPA llama a la API · HTTP :3001"| api
  api -->|"SQL mediante Drizzle"| postgres
  api -->|"guarda y sirve imágenes en /uploads/*"| uploads
```

Identity y Catalog se ejecutan dentro del mismo proceso de la API. `uploads/` es almacenamiento local del monolito, no un servicio separado.
