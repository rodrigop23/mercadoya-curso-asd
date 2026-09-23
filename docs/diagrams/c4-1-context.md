# C4 nivel 1 — System Context

MercadoYa ofrece un catálogo público y permite al administrador dar de alta productos.

```mermaid
flowchart LR
  buyer(["Comprador<br/>Actor"])
  admin(["Admin<br/>Actor"])
  mercadoya["MercadoYa<br/>Sistema<br/>Catálogo público y administración de productos"]

  buyer -->|"consulta el catálogo público"| mercadoya
  admin -->|"da de alta productos"| mercadoya
```

No se muestran sistemas externos: el alcance actual no depende de servicios externos.
