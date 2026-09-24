import { serve } from '@hono/node-server';
import { createApiLayer } from './api-layer.js';
import { createEventBusFromEnv } from './events/bootstrap.js';

const eventBus = await createEventBusFromEnv();
const app = await createApiLayer(eventBus);

const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3001),
  },
  (info) => {
    console.log(`MercadoYa API listening on http://localhost:${info.port}`);
  },
);

const shutdown = async () => {
  server.close();
  await eventBus.close();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
