# ADR 0019: catálogo admin con Module Federation Vite

Estado: aceptado. Fecha: 2026-09-30. Reemplaza la composición iframe de [ADR 0014](0014-mf-catalog-iframe.md).

## Decisión

Mantener React 19 y Vite 8 con `@module-federation/vite` 1.23.0, fijado en el lockfile. El host carga el componente `catalog/AdminProducts` con React.lazy después del guard. Shell, router, Better Auth, guard y QueryClientProvider siguen en el host. El remoto solo expone CRUD y recibe `apiBaseUrl`. No hay root propio, postMessage ni iframe en el camino de ejecución.

Compartir React, JSX runtimes, ReactDOM/client, TanStack Query y los subpaths UI como singleton, con versiones requeridas. El host es el proveedor; `import: false` en el remoto impide fallbacks. La UI workspace publica subpaths, no un módulo raíz. La política común vive en el export `@mercadoya/ui/federation`. El host genera los estilos de ambos y proporciona los tokens globales una vez. Este acuerdo requiere coordinar versiones UI y cambios CSS.

El entry es ESM, con `type: 'module'` explícito, filename `remoteEntry.js` y `manifest: true`. Se generan `mf-manifest.json` y `mf-stats.json`. El host usa entry directo para dev; el manifest es una alternativa en build/preview. Se mantiene splitting administrado por el plugin en Rolldown y target es2022. Ambos packages son ESM. Los puertos 5173/5174 son estables en dev/preview y el remoto anuncia `server.origin` y base absoluta. CI construye ambos sin remoto vivo y ejecuta smoke Playwright en dev, preview con entry y preview con manifest.

## Auth y límites

Las llamadas del slice salen del documento del host hacia Kong. La cookie de sesión va con credentials include; el host no pasa cookies ni tokens al módulo. Kong consulta Identity y Catalog valida JWT y rol según ADR 0018. El guard UI no sustituye esa autorización. No se agregan endpoints ni excepciones de auth. Los orígenes de assets y API son acuerdos distintos.

Un remoto ejecuta JS con los permisos del host. Se pierde el aislamiento de documento del iframe; su origen y su cadena de publicación deben ser confiables. CORS permite descargar assets, no gestionar productos. TLS, CSP, cookies, trustedOrigins y CORS del API deben configurarse para el despliegue real. No se introducen segundo MF buyer, SSR, Rspack ni migración total del admin.

El límite de errores rodea el slice. Una carga/evaluación fallida muestra aviso y recarga completa, manteniendo shell y otras rutas. React.lazy cachea errores de import; no basta con resetear el boundary. Los errores HTTP del CRUD mantienen sus mensajes actuales y el backend conserva 401/403.

## Documentación oficial verificada

Leída el 2026-09-30 y cotejada con los tipos y artefactos instalados:

- La URL solicitada `/integrations/bundler/vite` ya no responde; la [guía oficial vigente para Vite](https://module-federation.io/integrations/build-tool/vite) cubre origin, shared y containers ESM.
- [Ficha oficial npm](https://www.npmjs.com/package/@module-federation/vite) y [README del plugin](https://github.com/module-federation/vite#readme), versión 1.23.0. Se verificaron los tipos distribuidos para import false, singleton, versiones, manifest y suffix matching. El plugin controla `codeSplitting.groups` en Vite 8; no desactivar splitting ni usar manualChunks.
- [Vite server.origin y CORS](https://vite.dev/config/server-options), [opciones de build](https://vite.dev/config/build-options) y [base pública](https://vite.dev/config/shared-options#base). El repo utiliza Vite 8.3.0 y plugin React 6.1.1.
- [React.lazy](https://react.dev/reference/react/lazy) y [Suspense](https://react.dev/reference/react/Suspense). El error de la promesa llega al boundary y la promesa se cachea; React instalado es 19.3.0.

## Verificación

El smoke documentado en ambas apps usa fixtures de Kong para aislar composición. Compara por referencia los exports de React, ReactDOM, Button y QueryClient del remoto con el share scope del host, con un único proveedor del host. Comprueba CRUD, portales, ausencia de iframe, guards y caída del remoto. El job real Identity/Kong/Catalog sigue verificando autorización y JWT contra los servicios. No confundir fixtures del navegador con validación de autenticación real.

Verificación local de esta implementación: build, typecheck y lint de web, mf-catalog y UI pasaron. Playwright pasó cuatro casos en dev, cuatro en preview con remoteEntry y cuatro en preview con manifest. Se comprobó también que la cookie fixture viaja a Kong desde el origen del host. El smoke real de backend no se volvió a ejecutar en este cambio; se conserva su job de CI.
