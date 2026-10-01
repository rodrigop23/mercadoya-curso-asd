# ADR 0017: Identity propio y Kong OSS

Estado: aceptado.

Identity sale del proceso API; Catalog y Media permanecen allí hasta su siguiente extracción. Kong OSS `3.9.1`, fijado como `kong:3.9.1`, corre sin base de datos y sin Admin API pública. Es el borde HTTP del laboratorio.

El plugin JWT incluido en Kong usa credenciales registradas por consumer. No realiza discovery remoto de JWKS ni comprueba audience por sí solo. Una configuración con el issuer como credencial tampoco resuelve la rotación de claves identificadas por kid. El plugin OpenID Connect obtiene metadatos y claves, pero requiere Enterprise. No se configura OIDC ni se presenta el plugin JWT OSS como compatible con JWKS remoto.

Se usa el plugin Lua propio `identity-auth`, compatible con la API de plugins de Kong 3.9.1. En la fase access consulta el verificador interno de Identity. Identity valida una sesión de base de datos y emite un JWT, o verifica el JWT recibido con jose y JWKS. Kong solo proxifica tras un 200 con token; ante 401/403 rechaza, ante indisponibilidad responde 503. Orders, Inventory y las mutaciones de Catalog vuelven a verificar el JWT firmado. No se confía en headers de identidad ni se introduce un secreto compartido entre todos los servicios.

La sesión browser sigue siendo el mecanismo de login/logout y administración. El JWT de aplicación es RS256 con kid y claims obligatorios sub, role, iss, aud, iat y exp. Su issuer público es `http://localhost:8000`; su audience es `mercadoya-services`. La URL interna de JWKS puede cambiar sin cambiar issuer. Los JWT duran cinco minutos; una sesión revocada no revoca JWT ya emitidos. La rotación mantiene ambas claves durante un día; los verificadores cachean las claves y actualizan ante kid desconocido.

Las rutas de health, registro/login, consulta de sesión, token con sesión y JWKS conservan sus controles propios o acceso público. Kong protege Orders, Inventory, Notifications y mutaciones de Catalog. Los productos y uploads publicados siguen públicos. Inventory procesa la saga en un único contenedor. Las rutas internas de Catalog no se publican en Kong; Inventory usa `CATALOG_INTERNAL_TOKEN`, Notifications conserva `NOTIFICATIONS_INVOKE_TOKEN`.

El endpoint verificador añade una dependencia de Identity a cada solicitud del borde y una firma para las solicitudes con cookie. No hay caché de autorización en Kong. Para producción deben desplegarse réplicas, TLS y políticas de red; el Compose actual es local. No hay API Gateway de AWS, mesh ni extracción de Catalog/Media.

Las tablas Identity existentes se adoptan sin borrar datos y se añade jwks. La migración inicial de API permanece histórica; las nuevas migraciones Identity pertenecen a su servicio. Los comandos antiguos db:push/db:generate de API se retiran para evitar que eliminen las tablas que ya no aparecen en su esquema runtime.

Fuentes oficiales: [JWT de Better Auth](https://better-auth.com/docs/plugins/jwt), [sesiones Better Auth](https://better-auth.com/docs/concepts/session-management), [JWT Kong](https://developer.konghq.com/plugins/jwt/), [OIDC Kong Enterprise](https://developer.konghq.com/plugins/openid-connect/), [plugins Kong](https://developer.konghq.com/custom-plugins/handler.lua/) y [release OSS 3.9.1](https://github.com/Kong/kong/releases/tag/3.9.1).
