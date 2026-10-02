# 4. Pipeline local de imágenes con pipes & filters

## Estado

Aceptada

## Contexto

Catalog administra los productos y sus imágenes. Si Catalog también valida formatos, limpia metadatos y genera tamaños, la lógica del archivo queda mezclada con el dominio de productos. La sesión 4 introduce pipes & filters: pasos independientes que procesan un dato en secuencia.

El flujo de publicación ya permite mostrar este estilo con una imagen real. El procesamiento pertenece a Media; Catalog lo invoca por contrato.

## Decisión

Media procesa las imágenes en un pipeline local con cinco filtros:

`Validate → Sanitize → Resize → Persist → Attach`

- `Validate` acepta JPG, PNG o WebP de hasta 2 MiB.
- `Sanitize` elimina metadatos EXIF.
- `Resize` produce la imagen completa y una miniatura.
- `Persist` guarda ambos archivos en `apps/catalog-service/uploads/media/`.
- `Attach` deriva las rutas y URLs locales.

El upload llega en la solicitud de creación de producto a Catalog. Catalog llama a `MediaContract` y recibe `imagePath`, `thumbPath`, `imageUrl` y `thumbUrl`. La fila de producto guarda `imagePath`; la interfaz construye la URL pública a partir de esa ruta. Catalog no importa los filtros.

Los archivos permanecen en `uploads/`. Este flujo no usa S3. La demo cloud tiene otro runtime y otro límite, documentados en ADR 0007.

## Consecuencias

Media puede cambiar sus filtros sin mover la lógica de productos. La validación rechaza archivos antes de escribirlos en disco. El pipeline se ejecuta dentro de la solicitud HTTP; el procesamiento en segundo plano queda fuera de esta decisión.

El almacenamiento local requiere que el proceso API tenga permisos de escritura en `uploads/`. Este directorio no sustituye un almacenamiento de objetos para una aplicación desplegada en varias instancias.

## Seguimiento

La demo S3 → Lambda de la sesión 4 usa un pipeline independiente. No se conecta al publish de MercadoYa.
