import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';
import { federation } from '@module-federation/vite';
import { catalogShared } from '@mercadoya/ui/federation';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    server: { port: 5173, strictPort: true, origin: 'http://localhost:5173' },
    preview: { port: 5173, strictPort: true },
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      federation({
        name: 'mercadoya_web',
        remotes: {
          catalog: {
            type: 'module',
            name: 'mercadoya_catalog',
            entry: env.VITE_MF_CATALOG_ENTRY ?? 'http://localhost:5174/remoteEntry.js',
          },
        },
        shared: catalogShared(true),
        dts: false,
      }),
    ],
    build: { target: 'es2022' },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  };
});
