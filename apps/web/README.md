# MercadoYa Web

SPA React 19 con Vite 8 y TanStack Router. El host conserva shell, navegación, buyer, sesión Better Auth y `AdminAccessGuard`. `/admin/products` carga `catalog/AdminProducts` con `React.lazy` y `Suspense` después del guard. El remoto exporta el CRUD de catálogo; el host lo renderiza en su árbol React y su `QueryClientProvider`.

## Desarrollo y preview

Desde la raíz, `pnpm demo:infra` inicia Kong/Identity/Catalog y `pnpm dev` levanta host y remoto. El host usa `http://localhost:5173`; el remoto usa `http://localhost:5174`. Ambos fijan `strictPort`. Abre `/admin/products` con una sesión admin. El remoto no ofrece login ni un segundo shell.

```sh
pnpm exec turbo run build --filter=@mercadoya/web --filter=@mercadoya/mf-catalog
# Dos terminales, desde la raíz:
pnpm --filter @mercadoya/mf-catalog preview
pnpm --filter @mercadoya/web preview
```

Preview usa los mismos puertos que dev. Detén dev antes de iniciarlo. Vite mantiene splitting y target `es2022`; ambos packages tienen `type: module`.

Configura estas variables en `apps/web/.env.local` o en el entorno de build. Vite no carga el `.env` del backend en la raíz.

| Variable | Default | Uso |
| --- | --- | --- |
| `VITE_MF_CATALOG_ENTRY` | `http://localhost:5174/remoteEntry.js` | URL completa del container ESM; también acepta `mf-manifest.json` en build/preview |
| `VITE_API_URL` | `http://localhost:8000` | Kong, usado por auth, catálogo buyer y slice admin |

`server.origin` del host es `http://localhost:5173`. Para otro despliegue consulta la [guía del remoto](../mf-catalog/README.md). La URL del entry se fija al construir el host. Cambiarla requiere rebuild. Turbo incluye `VITE_*` en el hash de build y las pasa a dev. El build del host incluye el código del slice en sus inputs para invalidar el CSS cuando cambia el remoto.

## Shared y CSS

`@module-federation/vite` 1.23.0 negocia el scope `default`. [`@mercadoya/ui/federation`](../../packages/ui/federation.ts) define la política usada por ambas apps. React, sus runtimes JSX, ReactDOM, `react-dom/client`, TanStack Query y cada subpath UI tienen `singleton: true`, `strictVersion: true` y versión requerida explícita. El host proporciona las implementaciones; el remoto usa `import: false` y falla si no existe un proveedor compatible. `allowNodeModulesSuffixMatch` cubre la resolución de pnpm. Query comparte el provider del host; las queries admin usan una clave propia que incluye la URL de Kong.

UI solo exporta subpaths, por eso se registra cada componente y no un barrel inexistente `@mercadoya/ui`. Al añadir componentes al slice, actualiza la lista shared. El host importa `@mercadoya/ui/globals.css` una vez y Tailwind escanea también `apps/mf-catalog/src`. El remoto no inyecta resets, fuentes ni tokens. Un remoto con clases nuevas exige reconstruir el CSS del host. No hay aislamiento CSS.

## Auth y seguridad

Better Auth obtiene la sesión en Kong. El guard existente impide montar el slice para anónimos y buyers. El host pasa solo `apiBaseUrl`, sin cookie ni JWT en props, storage o mensajes. Las mutaciones del slice hacen fetch a Kong con `credentials: 'include'` desde el documento del host. El origen de los assets remotos no es un segundo origen de autenticación. Kong consulta Identity, emite/verifica JWT y Catalog verifica RS256/JWKS, issuer, audience, expiración y rol admin en cada escritura. Consulta [ADR 0018](../../docs/adr/0018-catalog-media-kong.md).

CORS y `trustedOrigins` deben permitir el origen del host. En producción hay que definir HTTPS, cookies y dominio de Kong/Identity conforme al despliegue; la carga de JS desde un CDN no resuelve restricciones de cookies entre sitios. El remote entry es código con todos los permisos del host, sin sandbox. Publica solo código confiable y controla su origen, CSP, TLS y acceso a los artefactos. CORS no autoriza operaciones de catálogo.

Si entry, chunks, CORS o evaluación fallan, `CatalogBoundary` muestra un aviso y un enlace de recarga; shell y otras rutas siguen operativas. React.lazy conserva una promesa rechazada: la recuperación hace una recarga completa tras reparar el remoto. Errores HTTP del CRUD conservan los estados y mensajes existentes, sin permitir acceso alternativo.

## Smoke

```sh
pnpm --filter @mercadoya/web exec playwright install chromium
# Tras construir ambas apps, sin servidores ocupando 5173/5174:
pnpm --filter @mercadoya/web smoke:federation
MF_SMOKE_MODE=dev pnpm --filter @mercadoya/web smoke:federation
```

Playwright inicia y detiene ambos servidores. Verifica render sin iframe, identidad por referencia de React/ReactDOM/Button/QueryClient con un solo proveedor del host, formulario y portales, crear/editar/eliminar, origen host de las escrituras, guards anónimo/buyer y recuperación cuando cae el remoto. Las respuestas de Kong son fixtures de navegador; este smoke prueba composición y transporte, no la criptografía ni una sesión real. CI lo ejecuta en ambos modos y comprueba preview usando manifest y mantiene el smoke real Identity/Kong/Catalog del otro job.

Smoke manual con backend real: inicia sesión admin, crea un producto con imagen, edita, elimina y revisa en Network que las mutaciones van a Kong desde `:5173`. Cierra sesión y repite como buyer; el guard debe impedir el catálogo admin. Detén el remoto y recarga `/admin/products`; debe aparecer el aviso y `/catalog` seguir funcionando.

## Fuentes verificadas

Consulta [ADR 0019](../../docs/adr/0019-catalog-module-federation.md) para las fuentes oficiales, decisiones y límites. Componentes Base UI/ShadCN y aliases en la [guía UI](../../packages/ui/README.md).
