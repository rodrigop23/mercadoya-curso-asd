# 7. Demo cloud aislada con S3 y Lambda

## Estado

Aceptada

## Contexto

ADR 0004 mantiene local el pipeline de imágenes de MercadoYa. La sesión 4 también enseña el estilo pipes & filters con un pipeline en AWS. La demo debe funcionar aparte del alta de productos para que el flujo local no dependa de AWS ni de sus credenciales.

## Decisión

El apéndice vive en `apps/cloud-pipeline-demo`. AWS CDK en TypeScript define un bucket S3, una Lambda con runtime Node.js 22 (`nodejs22.x`) y una notificación S3 `ObjectCreated` filtrada por el prefijo `inbox/`. La Lambda procesa el objeto y escribe el resultado bajo `outbox/`.

El flujo de la demo es `S3 inbox/ → Lambda → S3 outbox/`. La Lambda valida que el objeto sea una imagen de hasta 5 MiB y copia los bytes al prefijo de salida con metadatos de procesamiento. CloudWatch recibe los logs. No se requiere un AWS SDK desde las aplicaciones de MercadoYa.

La demo de clase se opera desde AWS Console: subir una imagen a `inbox/`, revisar los pasos en CloudWatch Logs y comprobar el resultado en `outbox/`. No usa un script AWS SDK como recorrido de clase. El docente prepara y despliega el CDK antes de la sesión.

Este paquete no se conecta con Catalog, Media, `POST /api/products` ni el publish de MercadoYa. El flujo de publicación sigue guardando archivos localmente en `uploads/`.

## Consecuencias

CDK y Lambda quedan versionados junto al curso y la demo se puede recorrer desde la consola AWS. La preparación requiere una cuenta y región de AWS y puede generar cargos de S3, Lambda y CloudWatch.

El bucket usa `RemovalPolicy.DESTROY` y borra sus objetos al destruir el stack, según la configuración del paquete. El stack de demo debe destruirse al terminar de usarlo.

## Seguimiento

No hay cambios de integración pendientes para la sesión 4. Conectar Media a S3 requeriría otra decisión.
