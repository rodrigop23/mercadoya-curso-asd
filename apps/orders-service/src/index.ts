import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { closeDb } from './db/index.js';
import { createEventBus } from './events/event-bus.js';
import {
  inventoryRejectedEventSchema,
  inventoryReservedEventSchema,
} from './events/inventory-events.js';
import { createIdentityContract } from './identity/contract.js';
import { createOrdersModule } from './orders/index.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const eventBus = await createEventBus();
const orders = createOrdersModule(eventBus, createIdentityContract());
await eventBus.subscribe('inventory.reserved', 'orders.confirm', async (payload) => {
  await orders.onInventoryReserved(inventoryReservedEventSchema.parse(payload));
});
await eventBus.subscribe('inventory.rejected', 'orders.reject', async (payload) => {
  await orders.onInventoryRejected(inventoryRejectedEventSchema.parse(payload));
});

const app = new Hono();
app.route('/api/orders', orders.routes);
const port = Number(process.env.PORT ?? 3002);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Orders service listening on http://localhost:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await eventBus.close();
  await closeDb();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
