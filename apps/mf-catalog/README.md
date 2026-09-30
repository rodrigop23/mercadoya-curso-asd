# Microfrontend de catálogo admin

Este proceso Vite sirve el CRUD de productos en `http://localhost:5174`. El host `apps/web` mantiene la sesión, el menú y el guard de `/admin/products`; esa ruta carga este proceso en un iframe.

```text
Navegador :5173 (host)
  └─ /admin/products → iframe :5174 (CRUD)
                          └─ Kong :8000 → Catalog/Media :3007
```

Para ejecutarlo solo, inicia la API y luego usa `pnpm --filter @mercadoya/mf-catalog dev`. Abre `http://localhost:5174` tras iniciar sesión como admin en el host. Para levantarlo junto al resto, ejecuta `pnpm demo:infra` y `pnpm dev` desde la raíz.

El iframe ofrece despliegue y estilos independientes, a costa de un documento y scroll separados. El host valida el origen de los mensajes de altura; el remoto valida el rol con `GET /api/me`. La API también comprueba el rol en cada escritura. Los puertos `5173` y `5174` comparten sitio `localhost`, por lo que el navegador envía la cookie a Kong `:8000` con `credentials: 'include'`. Kong permite ambos orígenes mediante CORS y Identity con Better Auth los incluye en `trustedOrigins`.

Configura `VITE_MF_CATALOG_URL` en el host si el remoto cambia de URL. Configura `VITE_API_URL` y `VITE_HOST_URL` en este proceso si cambian la API o el host. Sus valores por defecto son `http://localhost:8000` y `http://localhost:5173`. Usa el mismo hostname en host, remoto y API durante la demo; mezclar `localhost` con `127.0.0.1` impide compartir la cookie.

El catálogo buyer en `/catalog` sigue en el host. Buyer + admin no son dos MF; la composición aquí es host + pieza remota de administración.
