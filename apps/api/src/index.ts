import { serve } from '@hono/node-server';
import { createApiLayer } from './api-layer.js';

const app = createApiLayer();

const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3001),
  },
  (info) => {
    console.log(`MercadoYa API listening on http://localhost:${info.port}`);
  },
);

const shutdown = () => server.close();

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
