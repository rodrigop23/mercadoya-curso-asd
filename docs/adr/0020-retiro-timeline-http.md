# ADR 0020: retiro de la experiencia de eventos HTTP

Estado: aceptado. Fecha: 2026-09-30.

## Decisión

Se retiran la pantalla de eventos, el historial del pedido, su cliente y tipos de la web y el runtime HTTP que almacenaba eventos recientes en memoria. Kong y Compose anuncian únicamente Identity, Catalog/Media, Orders, Inventory y Notifications. El workspace descubre esas aplicaciones mediante sus patrones existentes, sin una tarea Turbo propia del runtime retirado.

Notifications conserva sus suscripciones a `payment.succeeded`, `inventory.rejected` y `payment.failed`, valida los mismos contratos y envía los mismos correos. El handler registra los resultados en logs locales o CloudWatch y responde 202 sin ingest HTTP. Se retiran los parámetros CDK y secretos exclusivos de ese ingest.

Los subjects, schemas, productores y consumidores NATS de la saga permanecen iguales. El worker Polar permanece dentro de Orders. Las migraciones y tablas históricas se conservan para instalaciones existentes.

## Operación

Catalog monta `apps/catalog-service/uploads`. Al actualizar una instalación, copia la carpeta de imágenes anterior completa a ese directorio antes de iniciar Catalog. `image_path` conserva sus valores relativos. La carpeta está ignorada por Git y excluida del contexto Docker.

Las guías y diagramas de etapas anteriores están identificados como históricos y no son instrucciones de despliegue. El README y los diagramas v4 describen los servicios actuales. En una instalación existente, `docker compose up -d --build --remove-orphans` retira el contenedor huérfano del runtime eliminado.

## Verificación

El smoke de gateway comprueba que las antiguas rutas de eventos devuelven 404 y mantiene login, JWT, CRUD, stock y confirmación de saga. Los tests de Notifications verifican correos, stub, errores y los tres contratos sin llamadas HTTP adicionales. Las comprobaciones de saga mantienen rechazo, restitución y eventos duplicados.
