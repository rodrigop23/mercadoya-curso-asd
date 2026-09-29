import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createCatalogHttpClient } from './catalog/http.js';
import { closeDb } from './db/index.js';
import { createEventBus } from './events/event-bus.js';
import { createIdentityContract } from './identity/contract.js';
import { createInventoryModule } from './inventory/index.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const catalog = createCatalogHttpClient();
const eventBus = await createEventBus();
const inventory = createInventoryModule(catalog, eventBus, createIdentityContract());
await eventBus.subscribe('orders.placed', 'inventory.reserve', inventory.onOrderPlaced);

const app = new Hono();
app.route('/api/inventory', inventory.routes);
const port = Number(process.env.PORT ?? 3003);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Inventory service listening on http://localhost:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await eventBus.close();
  await closeDb();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
