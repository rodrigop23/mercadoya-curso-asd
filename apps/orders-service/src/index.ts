import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import {
  eventSubjects,
  inventoryRejectedEventSchema,
  paymentSucceededEventSchema,
  paymentFailedEventSchema,
  inventoryReleasedEventSchema,
} from '@mercadoya/contracts';
import { subscribePaymentSimulator } from './payment/simulator.js';
import { closeDb, pool } from './db/index.js';
import { paymentProvider, polarConfig } from './payment/config.js';
import { createPolarGateway } from './payment/polar.js';
import { createPolarWebhookRoutes } from './payment/webhook.js';
import { createPaymentWorker } from './payment/worker.js';
import { createEventBus } from './events/event-bus.js';
import { createIdentityContract } from './identity/contract.js';
import { createOrdersModule } from './orders/index.js';
import { createCatalogBillingClient } from './catalog/http.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const provider = paymentProvider();
const polar = provider === 'polar' ? polarConfig() : null;
const eventBus = await createEventBus();
const worker = polar ? createPaymentWorker(pool, eventBus, createPolarGateway(polar)) : null;
const orders = createOrdersModule(
  eventBus,
  createIdentityContract(),
  worker ?? undefined,
  polar ? createCatalogBillingClient() : undefined,
);
await eventBus.subscribe(eventSubjects.paymentSucceeded, 'orders.confirm', async (payload) => {
  await orders.onPaymentSucceeded(paymentSucceededEventSchema.parse(payload));
});
await eventBus.subscribe(eventSubjects.paymentFailed, 'orders.reject_payment', async (payload) => {
  await orders.onPaymentFailed(paymentFailedEventSchema.parse(payload));
});
await eventBus.subscribe(eventSubjects.inventoryReleased, 'orders.compensated', async (payload) => {
  await orders.onInventoryReleased(inventoryReleasedEventSchema.parse(payload));
});
await eventBus.subscribe(
  eventSubjects.inventoryRejected,
  'orders.reject_stock',
  async (payload) => {
    await orders.onInventoryRejected(inventoryRejectedEventSchema.parse(payload));
  },
);
if (worker) {
  await eventBus.subscribe(
    eventSubjects.inventoryReserved,
    'payment.polar',
    worker.onInventoryReserved,
  );
  worker.start();
} else {
  await subscribePaymentSimulator(eventBus);
}

const app = new Hono();
app.route('/api/orders', orders.routes);
if (polar && worker)
  app.route(
    '/api/payments/polar/webhook',
    createPolarWebhookRoutes(polar.webhookSecret, worker.enqueue),
  );
else
  app.post('/api/payments/polar/webhook', (c) => c.json({ error: 'Polar no está activo.' }, 503));
const port = Number(process.env.PORT ?? 3002);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Orders service listening on http://localhost:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await worker?.stop();
  await eventBus.close();
  await closeDb();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
