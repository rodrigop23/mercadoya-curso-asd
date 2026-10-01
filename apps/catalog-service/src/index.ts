import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { closeDb, pool } from './db/index.js';
import { catalogPolarConfig } from './modules/catalog/polar-config.js';
import { createProductGateway } from './modules/catalog/polar-gateway.js';
import { createProductSyncWorker } from './modules/catalog/polar-worker.js';

const polar = catalogPolarConfig();
const worker = createProductSyncWorker(pool, polar.server, createProductGateway(polar));
await worker.start();

const server = serve({ fetch: createApp().fetch, port: Number(process.env.PORT ?? 3007) }, (info) =>
  console.log(`Catalog/Media listening on http://localhost:${info.port}`),
);
const shutdown = () =>
  server.close(() => {
    void (async () => {
      await worker.stop();
      await closeDb();
    })();
  });
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
