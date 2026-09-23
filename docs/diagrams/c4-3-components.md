# C4 nivel 3 — Components (V1 modular)

La API compone los módulos Identity y Catalog dentro de un único proceso Node/Hono.

```mermaid
flowchart LR
  subgraph api["@mercadoya/api · un solo proceso Node/Hono"]
    direction LR

    wiring["index.ts<br/>Composition root<br/>crea módulos, inyecta contrato<br/>y monta las rutas en Hono"]

    subgraph identity["Módulo Identity"]
      direction TB
      identityRoutes["routes.ts<br/>rutas de sesión y auth"]
      identityContract["IdentityContract<br/>getSession(headers)<br/>requireAdmin(headers)"]
      identityService["service.ts<br/>implementación del contrato"]
      betterAuth["Better Auth<br/>interno de Identity"]

      identityRoutes -->|"consulta sesión"| identityContract
      identityService -->|"implementa"| identityContract
      identityService -->|"usa internamente"| betterAuth
    end

    subgraph catalog["Módulo Catalog"]
      direction TB
      catalogRoutes["routes.ts<br/>rutas de productos"]
      catalogService["service.ts<br/>lógica y persistencia de productos"]
      catalogRoutes --> catalogService
    end

    wiring -->|"crea y monta"| identityRoutes
    wiring -->|"createCatalogModule(identity.contract)"| catalogRoutes
    catalogRoutes -->|"IdentityContract en proceso<br/>requireAdmin(headers) · getSession(headers)"| identityContract
  end

  postgres[("PostgreSQL<br/>base compartida")]
  uploads[("Disco local<br/>uploads/")]

  betterAuth -->|"persistencia de auth"| postgres
  catalogService -->|"productos · Drizzle"| postgres
  catalogService -->|"escritura de imágenes"| uploads
```

Las flechas entre Identity, Catalog y `index.ts` son llamadas y composición en el mismo proceso: no hay red ni despliegues separados entre módulos. PostgreSQL y `uploads/` son recursos usados por el monolito.
