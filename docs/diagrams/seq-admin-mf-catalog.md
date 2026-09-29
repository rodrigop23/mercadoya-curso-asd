# Secuencia S5: administración de productos en el MF

El host controla la ruta y el guard; el iframe sirve el formulario y ejecuta el CRUD. El API vuelve a comprobar la autorización en cada escritura.

```mermaid
sequenceDiagram
  actor Admin
  participant Host as Web host :5173
  participant MF as MF catálogo :5174
  participant API as API gateway :3001
  participant Identity as Identity
  participant Catalog as Catalog
  participant DB as PostgreSQL

  Admin->>Host: abre /admin/products
  Host->>API: GET /api/me con cookie
  API-->>Host: sesión admin
  Host->>MF: monta iframe :5174
  MF->>API: GET /api/me con cookie
  API-->>MF: rol admin
  MF->>API: GET /api/products
  API->>Catalog: listar productos
  Catalog-->>API: productos
  API-->>MF: productos
  MF-->>Host: postMessage con altura
  Host->>Host: valida origen :5174 y ajusta iframe
  opt crear producto
    Admin->>MF: envía formulario
    MF->>API: POST /api/products con cookie
    API->>Identity: requireAdmin
    Identity-->>API: autorizado
    API->>Catalog: crear producto
    Catalog->>DB: INSERT product
    API-->>MF: 201 y producto
  end
  opt editar producto
    MF->>API: PUT /api/products/:id con cookie
    API->>Identity: requireAdmin
    API->>Catalog: actualizar producto
    Catalog->>DB: UPDATE product
    API-->>MF: producto actualizado
  end
  opt eliminar producto
    MF->>API: DELETE /api/products/:id con cookie
    API->>Identity: requireAdmin
    API->>Catalog: eliminar producto
    Catalog->>DB: DELETE product
    API-->>MF: 204 No Content
  end
```

El catálogo buyer `/catalog` sigue en el host. La composición tiene un host y un MF admin, no un MF buyer y otro admin.
