import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createCatalogModule } from './modules/catalog/index.js';
import { createIdentityModule } from './modules/identity/index.js';

const identity = createIdentityModule();
const catalog = createCatalogModule(identity.contract);
const app = new Hono();

app.use('/api/*', cors({ origin: 'http://localhost:5173', credentials: true }));
app.get('/', (c) => c.text('MercadoYa API está lista.'));
app.route('/', identity.routes);
app.route('/', catalog.routes);

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3001),
  },
  (info) => {
    console.log(`MercadoYa API listening on http://localhost:${info.port}`);
  },
);
