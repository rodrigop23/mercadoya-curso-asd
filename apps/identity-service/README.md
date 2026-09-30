# Identity

Identity corre en `:3006`. Better Auth `1.7.5` y su adapter Drizzle están fijados en el lockfile. Es propietario de `user`, `session`, `account`, `verification` y `jwks`. Catalog y Media corren juntos en `apps/catalog-service` :3007.

```sh
pnpm --filter @mercadoya/identity-service db:migrate
pnpm --filter @mercadoya/identity-service dev
```

Compose incluye su imagen y puerto de diagnóstico ligado a loopback. El navegador usa Kong en `:8000`, con `BETTER_AUTH_URL` y `JWT_ISSUER` iguales a `http://localhost:8000`. `JWT_AUDIENCE=mercadoya-services` debe coincidir en Identity y los verificadores. `IDENTITY_URL` identifica el transporte interno, no el issuer. En Compose es `http://identity:3006`.

La migración SQL es transaccional e idempotente. Adopta las tablas existentes sin copiar ni borrar usuarios, contraseñas o sesiones y añade la tabla JWKS con los campos de la versión instalada. La migración histórica de API permanece inmutable para instalaciones antiguas. Ya no se usa `db:push` desde API sobre la base compartida. Los cambios futuros de Identity se escriben en sus propias migraciones.

El browser conserva la cookie HttpOnly `better-auth.session_token` y envía `credentials: include`. Login, logout, administración y `/api/me` usan la sesión persistida. El cookie cache está desactivado. `/api/auth/token` requiere sesión y devuelve un JWT de aplicación; `/api/auth/jwks` publica solo claves públicas. No se guarda el JWT en localStorage.

El plugin JWT oficial firma con RS256, incluye `kid`, `sub` como ID del usuario, `role` como `user` o `admin`, `iss`, `aud`, `iat` y `exp`. Dura cinco minutos. El payload excluye email, contraseña y el token de sesión. Las claves privadas se cifran con Better Auth y permanecen en PostgreSQL; `BETTER_AUTH_SECRET` debe mantenerse fuera del repositorio y estable entre reinicios. Las claves rotan a los treinta días con un día de solapamiento. La revocación de sesión corta el uso de cookie inmediatamente; un JWT emitido sigue válido hasta su expiración.

Kong llama al endpoint interno `POST /api/identity/verify`. Con cookie, Identity comprueba la sesión y emite un JWT. Con Authorization, verifica firma y claims por JWKS; una credencial Bearer inválida no cae a la cookie. La comprobación de Origin permite solo web `:5173`, MF `:5174` y el origen público configurado. Kong no publica `/api/identity/verify` y nunca confía en headers de usuario enviados por el cliente.

`@mercadoya/jwt-verifier` usa `jose`, fija RS256 y requiere los claims anteriores. Cachea JWKS durante sesenta segundos y vuelve a consultar un `kid` desconocido, con cooldown de cinco segundos. Durante ese cooldown una clave recién rotada puede producir un 401 transitorio. Health es público; un fallo de Identity o JWKS produce 5xx y no autoriza la solicitud.

Para ejecutar el smoke contra una base de prueba:

```sh
DATABASE_URL=postgresql://mercadoya:mercadoya_local@localhost:5432/mercadoya pnpm --filter @mercadoya/identity-service smoke
```

El smoke crea un usuario y producto temporales, inicia sesión, verifica JWKS y JWT, crea pedidos con cookie y con Bearer y espera confirmación y reserva Inventory v2. Borra el usuario y producto al terminar; deja pedidos para diagnóstico. CI usa un stack efímero. No ejecutes este smoke contra una base de producción.

Documentación verificada para esta implementación: [Better Auth JWT](https://better-auth.com/docs/plugins/jwt), [sesiones](https://better-auth.com/docs/concepts/session-management), [Kong JWT](https://developer.konghq.com/plugins/jwt/), [Kong OIDC](https://developer.konghq.com/plugins/openid-connect/) y [plugin Lua de Kong](https://developer.konghq.com/custom-plugins/handler.lua/). Además se contrastaron el esquema y las opciones con el código instalado de Better Auth 1.7.5.
