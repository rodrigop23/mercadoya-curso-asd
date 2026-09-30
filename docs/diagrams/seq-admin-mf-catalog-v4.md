# Secuencia actual: administración de productos en el MF

El host controla la ruta y el guard; el iframe sirve el formulario y ejecuta el CRUD. Kong valida la sesión con Identity y Catalog verifica el JWT y rol en cada escritura.

```mermaid
sequenceDiagram
  actor Admin
  participant Host as Web host :5173
  participant MF as MF catálogo :5174
  participant API as Kong :8000
  participant Identity as Identity :3006
  participant Catalog as Catalog en API :3001
  participant DB as PostgreSQL

  Admin->>Host: abre /admin/products
  Host->>API: GET /api/me con cookie
  API->>Identity: consultar sesión
  Identity-->>API: sesión
  API-->>Host: sesión admin
  Host->>MF: monta iframe :5174
  MF->>API: GET /api/me con cookie
  API->>Identity: consultar sesión
  Identity-->>API: sesión
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
    API->>Identity: verificar sesión y emitir JWT
    Identity-->>API: JWT RS256
    API->>Catalog: crear producto con Bearer
    Catalog->>Catalog: verificar firma, claims y rol admin
    Catalog->>DB: INSERT product
    API-->>MF: 201 y producto
  end
  opt editar producto
    MF->>API: PUT /api/products/:id con cookie
    API->>Identity: verificar sesión y emitir JWT
    Identity-->>API: JWT RS256
    API->>Catalog: actualizar producto con Bearer
    Catalog->>Catalog: verificar firma, claims y rol admin
    Catalog->>DB: UPDATE product
    API-->>MF: producto actualizado
  end
  opt eliminar producto
    MF->>API: DELETE /api/products/:id con cookie
    API->>Identity: verificar sesión y emitir JWT
    Identity-->>API: JWT RS256
    API->>Catalog: eliminar producto con Bearer
    Catalog->>Catalog: verificar firma, claims y rol admin
    Catalog->>DB: DELETE product
    API-->>MF: 204 No Content
  end
```

El catálogo buyer `/catalog` sigue en el host. La composición tiene un host y un MF admin, no un MF buyer y otro admin.
