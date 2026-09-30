# Remote de catálogo admin

`@module-federation/vite` 1.23.0 expone `./AdminProducts` bajo el nombre `mercadoya_catalog`. El host lo consume como `catalog/AdminProducts` en `/admin/products`. El contrato es un componente React con `apiBaseUrl: string`; usa el provider Query del host. No crea root, router, shell, sesión ni guard propios.

```text
Documento host :5173
  /admin/products → guard → import async de :5174/remoteEntry.js
    → slice React en el árbol host → Kong :8000 → Identity/Catalog
```

## Ejecución y artefactos

Desde la raíz, `pnpm dev` levanta ambas apps. Solo el proceso remoto se inicia con `pnpm --filter @mercadoya/mf-catalog dev`. Abre `/admin/products` en el host. La página `:5174` solo informa que este proceso sirve un módulo para el host.

```sh
pnpm exec turbo run build --filter=@mercadoya/web --filter=@mercadoya/mf-catalog
# En dos terminales, tras detener dev:
pnpm --filter @mercadoya/mf-catalog preview
pnpm --filter @mercadoya/web preview
```

Dev y preview usan `:5174` para el remote y `:5173` para el host, ambos con `strictPort`. El entry ESM vive en `http://localhost:5174/remoteEntry.js`. `manifest: true` emite `dist/mf-manifest.json` y `dist/mf-stats.json` además del entry y los chunks. El host usa el entry directo por defecto; en build/preview puede consumir el manifest con `VITE_MF_CATALOG_ENTRY=http://localhost:5174/mf-manifest.json`. El manifest describe un entry con tipo `module`; no se usa formato global `var`.

| Variable del remoto | Default | Uso |
| --- | --- | --- |
| `VITE_CATALOG_ORIGIN` | `http://localhost:5174` | `server.origin` y base absoluta de los assets |
| `VITE_WEB_ORIGIN` | `http://localhost:5173` | CORS de assets en dev/preview |

Guárdalas en `apps/mf-catalog/.env.local` o pásalas al build. Para desplegar, construye con el origen público real del remoto y configura la URL completa del entry en el host. Sirve los chunks con CORS para el host, MIME JS y HTTPS; publica entry y manifest junto a sus chunks. Evita cachear indefinidamente entry/manifest y conserva chunks de versiones anteriores durante la actualización. Los puertos de la demo no son una estrategia de despliegue.

Vite 8 usa Rolldown. El plugin controla splitting; no se desactiva ni se configura `manualChunks`. El target es `es2022`; packages ESM con `type: module`. Los tipos del contrato están declarados en el host y `dts: false` evita descargas de tipos durante el build sin remoto vivo.

## Shared, estilos y autenticación

La política shared está en [`@mercadoya/ui/federation`](../../packages/ui/federation.ts). El host proporciona React/ReactDOM, runtimes JSX, TanStack Query y subpaths UI con singleton, strictVersion y versiones explícitas; el remoto no tiene fallbacks locales. No existe modo React standalone. Mantén compatibles las versiones de ambas apps y añade a la política los nuevos subpaths UI.

El host genera todo el CSS y escanea este slice. El remoto no carga CSS global. Cambios en clases requieren build coordinado del host. Buyer permanece en `/catalog` del host; no hay segundo MF, SSR ni migración del resto del admin.

El remoto recibe la URL de Kong del host. Fetch se ejecuta en el documento del host y las escrituras llevan `credentials: 'include'`; no depende de coincidencias de cookies entre documentos. La sesión se consulta una vez en el host y el guard mantiene su rol. Kong/Identity y Catalog vuelven a autorizar cada mutación, como define [ADR 0018](../../docs/adr/0018-catalog-media-kong.md). No hay postMessage, height observer ni variables de iframe.

El JS remoto comparte privilegios, DOM y estilos con el host. Solo debe cargarse desde un origen de código confiable. No es una frontera de seguridad. Si falla su carga o evaluación, el host muestra un aviso de recuperación sin desmontar el shell; una recarga completa reintenta después de reparar el servicio. Consulta [seguridad y smoke](../web/README.md) y [ADR 0019](../../docs/adr/0019-catalog-module-federation.md).
