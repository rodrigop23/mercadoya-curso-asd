import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { closeDb } from './db/index.js';

const server = serve({ fetch: createApp().fetch, port: Number(process.env.PORT ?? 3007) }, (info) =>
  console.log(`Catalog/Media listening on http://localhost:${info.port}`),
);
const shutdown = () =>
  server.close(() => {
    void closeDb();
  });
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
