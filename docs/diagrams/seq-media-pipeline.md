# Secuencia S4 / V2: pipeline local de imágenes (histórico)

El pipeline Media sigue en el API, pero en S5 el formulario admin vive en el [MF catálogo](seq-admin-mf-catalog.md). Esta secuencia conserva la UI de V2.

El alta de producto entra por Catalog. Catalog pide a Media procesar la imagen y conserva la ruta que devuelve el pipeline.

```mermaid
sequenceDiagram
  actor Admin
  participant Web as Web SPA /admin/products
  participant API as API Hono
  participant Identity
  participant Catalog
  participant Media as MediaContract
  participant Validate
  participant Sanitize
  participant Resize
  participant Persist
  participant Attach
  participant Disk as uploads/
  participant DB as PostgreSQL

  Admin->>Web: completa el producto y selecciona imagen
  Web->>API: POST /api/products (multipart/form-data)
  API->>Identity: requireAdmin(headers)
  Identity-->>API: autorización válida
  API->>Catalog: createProduct(datos, image)
  Catalog->>Media: processProductImage(file)
  Media->>Validate: comprobar MIME y tamaño

  alt imagen aceptada
    Validate-->>Media: continuar
    Media->>Sanitize: eliminar metadatos EXIF
    Sanitize-->>Media: imagen saneada
    Media->>Resize: generar full y thumbnail
    Resize-->>Media: bytes redimensionados
    Media->>Persist: guardar ambos archivos
    Persist->>Disk: escribir en media/
    Disk-->>Persist: rutas imagePath y thumbPath
    Persist-->>Media: archivos guardados
    Media->>Attach: derivar rutas y URLs locales
    Attach-->>Media: imageUrl y thumbUrl
    Media-->>Catalog: ProductImage con rutas y URLs
    Catalog->>DB: INSERT product con imagePath
    DB-->>Catalog: producto creado
    Catalog-->>API: producto con imagePath
    API-->>Web: 201 Created
    Web-->>Admin: muestra confirmación
  else Validate rechaza la imagen
    Validate-->>Media: InvalidMediaError
    Media-->>Catalog: error de validación
    Catalog-->>API: InvalidMediaError
    API-->>Web: 400 Bad Request
    Web-->>Admin: muestra el motivo del rechazo
  end
```

Media deriva `imageUrl` y `thumbUrl`, pero Catalog guarda `imagePath` en la fila de producto. El catálogo público construye la URL de la imagen completa a partir de esa ruta. El rechazo de `Validate` ocurre antes de guardar archivos.
