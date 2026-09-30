import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { federation } from '@module-federation/vite';
import { catalogShared } from '@mercadoya/ui/federation';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const origin = env.VITE_CATALOG_ORIGIN ?? 'http://localhost:5174';
  const cors = { origin: env.VITE_WEB_ORIGIN ?? 'http://localhost:5173' };
  return {
    base: `${origin}/`,
    server: { port: 5174, strictPort: true, origin, cors },
    preview: { port: 5174, strictPort: true, cors },
    plugins: [
      react(),
      tailwindcss(),
      federation({
        name: 'mercadoya_catalog',
        filename: 'remoteEntry.js',
        manifest: true,
        exposes: { './AdminProducts': './src/catalog-slice.tsx' },
        shared: catalogShared(false),
        dts: false,
      }),
    ],
    build: { target: 'es2022' },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  };
});
