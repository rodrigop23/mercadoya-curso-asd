import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Pool } from 'pg';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { createCatalogBillingClient } from '../dist/catalog/http.js';
import { eventSubjects } from '@mercadoya/contracts';
import { createEventBus } from '../dist/events/event-bus.js';
import { createPaymentWorker } from '../dist/payment/worker.js';
import { createPolarWebhookRoutes } from '../dist/payment/webhook.js';
import { CheckoutRejected } from '../dist/payment/polar.js';

// Recursos dedicados; nunca ejecutar sobre DATABASE_URL del desarrollador.
assert.ok(process.env.PAYMENTS_TEST_DATABASE_URL, 'Configura PAYMENTS_TEST_DATABASE_URL dedicado.');
assert.ok(process.env.PAYMENTS_TEST_NATS_URL, 'Configura PAYMENTS_TEST_NATS_URL dedicado.');
const base = new Pool({ connectionString: process.env.PAYMENTS_TEST_DATABASE_URL });
const schema = `polar_test_${randomBytes(8).toString('hex')}`;
await base.query(`CREATE SCHEMA ${schema}`);
const databaseUrl = new URL(process.env.PAYMENTS_TEST_DATABASE_URL);
databaseUrl.searchParams.set('options', `-csearch_path=${schema}`);
process.env.DATABASE_URL = databaseUrl.href;
process.env.NATS_URL = process.env.PAYMENTS_TEST_NATS_URL;
process.env.EVENT_BUS = 'nats';
process.env.EMAIL_MODE = 'stub';
process.env.DEMO_NOTIFY_EMAIL = 'saga-test@example.com';
process.env.NOTIFICATIONS_INVOKE_TOKEN = randomBytes(32).toString('base64url');
const { pool, closeDb } = await import('../dist/db/index.js');
const { closeDb: closeInventoryDb } = await import('../../inventory-service/dist/db/index.js');
const { createOrdersModule } = await import('../dist/orders/index.js');
const { createOrdersService } = await import('../dist/orders/service.js');
const { createInventoryModule } = await import('../../inventory-service/dist/inventory/index.js');
const { subscribeInventoryEvents } =
  await import('../../inventory-service/dist/events/subscriptions.js');
const { handler: notify } = await import('../../notifications-lambda/dist/src/handler.js');
// Las tablas de saga conservan el baseline real sin crear Identity en este schema.
const baseline = await readFile(
  new URL('../../catalog-service/drizzle/0000_lumpy_lockheed.sql', import.meta.url),
  'utf8',
);
for (const name of ['product', 'orders_order', 'inventory_reservations']) {
  await pool.query(baseline.match(new RegExp(`CREATE TABLE "${name}" \\([\\s\\S]*?\\n\\);`))[0]);
}
await pool.query('CREATE UNIQUE INDEX inventory_order_unique ON inventory_reservations(order_id)');
await pool.query(await readFile(new URL('../db/0001_payments.sql', import.meta.url), 'utf8'));
await pool.query(await readFile(new URL('../db/0002_pricing.sql', import.meta.url), 'utf8'));
await pool.query(
  await readFile(
    new URL('../../catalog-service/drizzle/0001_polar_products.sql', import.meta.url),
    'utf8',
  ),
);
await pool.query(
  await readFile(
    new URL('../../catalog-service/drizzle/0002_polar_retry_limits.sql', import.meta.url),
    'utf8',
  ),
);
process.env.POLAR_SERVER = 'sandbox';
process.env.CATALOG_INTERNAL_TOKEN = randomBytes(32).toString('base64url');
const { pool: catalogPool, closeDb: closeCatalogDb } =
  await import('../../catalog-service/dist/db/index.js');
const { createCatalogContract } =
  await import('../../catalog-service/dist/modules/catalog/service.js');
const { createCatalogRoutes } =
  await import('../../catalog-service/dist/modules/catalog/routes.js');
const { createProductSyncWorker } =
  await import('../../catalog-service/dist/modules/catalog/polar-worker.js');
const { createCatalogHttpClient } = await import('../../inventory-service/dist/catalog/http.js');
const catalog = createCatalogContract({
  processProductImage: async () => ({ imagePath: 'media/test.png' }),
  deleteProductImage: async () => {},
});
const catalogRoutes = createCatalogRoutes(
  { requireAdmin: async () => ({ allowed: true }) },
  catalog,
);
const catalogServer = serve({ fetch: catalogRoutes.fetch, hostname: '127.0.0.1', port: 0 });
await once(catalogServer, 'listening');
process.env.CATALOG_URL = `http://127.0.0.1:${catalogServer.address().port}`;
const catalogBilling = createCatalogBillingClient();
const catalogStock = createCatalogHttpClient();
const polarProducts = new Map();
const productWorker = createProductSyncWorker(catalogPool, 'sandbox', {
  prepare: async () => {},
  find: async (id) => polarProducts.get(id)?.id ?? null,
  create: async (id, desired) => {
    const remoteId = randomUUID();
    polarProducts.set(id, { id: remoteId, ...desired });
    return remoteId;
  },
  update: async (id, desired) => {
    Object.assign(
      [...polarProducts.values()].find((p) => p.id === id),
      desired,
    );
  },
});
const bus = await createEventBus();
const buyerId = randomUUID();
const identity = {
  getSession: async (headers) =>
    headers.get('authorization') === 'Bearer buyer' ? { user: { id: buyerId } } : null,
};
const stock = new Map();
const sessions = new Map();
let creations = 0;
let uncertain = false;
let rejected = false;
let failPublish = false;
const gateway = {
  async create(event, product) {
    assert.equal(product.currency, 'pen');
    assert.equal(product.productId, event.productId);
    creations++;
    if (rejected) throw new CheckoutRejected('polar_checkout_rejected');
    const session = {
      id: randomUUID(),
      url: 'https://sandbox.polar.sh/checkout/test',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      amount: product.unitAmount * event.quantity,
      currency: 'pen',
      status: 'open',
    };
    sessions.set(event.orderId, session);
    if (uncertain) throw new Error('network_uncertain');
    return session;
  },
  async find(event) {
    return sessions.get(event.orderId) ?? null;
  },
};
const publisher = {
  ...bus,
  async publish(subject, payload) {
    if (failPublish && subject === eventSubjects.paymentSucceeded) {
      failPublish = false;
      throw new Error('nats_unavailable');
    }
    await bus.publish(subject, payload);
  },
};
let worker = createPaymentWorker(pool, publisher, gateway);
const orders = createOrdersModule(
  bus,
  identity,
  {
    getCheckout: (...args) => worker.getCheckout(...args),
  },
  catalogBilling,
);
const service = createOrdersService(bus, catalogBilling);
const inventory = createInventoryModule(
  {
    async getAvailableStock(productId) {
      return catalogStock.getAvailableStock(productId);
    },
    async adjustStock(productId, delta) {
      const result = await catalogStock.adjustStock(productId, delta);
      if (result.adjusted) stock.set(productId, result.availableStock);
      return result;
    },
  },
  bus,
  identity,
);
const trace = [];
const notificationResults = [];
for (const subject of Object.values(eventSubjects))
  await bus.subscribe(subject, `polar-test.trace.${schema}`, async (payload) => {
    trace.push({ subject, payload });
  });
await subscribeInventoryEvents(bus, inventory);
await bus.subscribe(eventSubjects.inventoryReserved, `polar-test.checkout.${schema}`, (payload) =>
  worker.onInventoryReserved(payload),
);
await bus.subscribe(
  eventSubjects.paymentSucceeded,
  `polar-test.confirm.${schema}`,
  orders.onPaymentSucceeded,
);
await bus.subscribe(
  eventSubjects.paymentFailed,
  `polar-test.reject.${schema}`,
  orders.onPaymentFailed,
);

await bus.subscribe(
  eventSubjects.inventoryReleased,
  `polar-test.compensated.${schema}`,
  orders.onInventoryReleased,
);
await bus.subscribe(
  eventSubjects.inventoryRejected,
  `polar-test.reject-stock.${schema}`,
  orders.onInventoryRejected,
);
for (const subject of [eventSubjects.paymentSucceeded, eventSubjects.paymentFailed])
  await bus.subscribe(subject, `polar-test.notify.${schema}`, async (payload) => {
    notificationResults.push(
      await notify({
        body: JSON.stringify({ subject, payload }),
        headers: { 'x-invoke-token': process.env.NOTIFICATIONS_INVOKE_TOKEN },
      }),
    );
  });
const secret = `whsec_${randomBytes(32).toString('base64')}`;
const app = new Hono().route('/api/orders', orders.routes).route(
  '/api/payments/polar/webhook',
  createPolarWebhookRoutes(secret, (event) => worker.enqueue(event)),
);
async function until(check) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail('Timeout esperando la saga.');
}
async function createOrder(quantity = 2) {
  const product = await catalog.createProduct({
    title: 'Producto saga',
    description: 'Prueba',
    price: 20,
    stock: 10,
    image: new File(['fixture'], 'test.png'),
  });
  const productId = product.id;
  stock.set(productId, 10);
  await productWorker.tick();
  const response = await app.request('/api/orders', {
    method: 'POST',
    headers: { authorization: 'Bearer buyer', 'content-type': 'application/json' },
    body: JSON.stringify({ productId, quantity }),
  });
  assert.equal(response.status, 202);
  const { order } = await response.json();
  await until(
    async () =>
      (await pool.query('SELECT 1 FROM orders_payment_checkout WHERE order_id=$1', [order.id]))
        .rowCount === 1,
  );
  await worker.tick();
  return order;
}
function eventFor(order, type, status) {
  const session = sessions.get(order.id);
  return {
    type,
    timestamp: new Date().toISOString(),
    data: type.startsWith('order.')
      ? {
          id: randomUUID(),
          checkout_id: session.id,
          metadata: { order_id: order.id },
          status,
          paid: status === 'paid',
          subtotal_amount: session.amount,
          currency: session.currency,
        }
      : { id: session.id, status, metadata: { order_id: order.id } },
  };
}
async function deliver(event, eventId = randomUUID()) {
  const body = JSON.stringify(event, null, 2);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`${eventId}.${timestamp}.${body}`)
    .digest('base64');
  return app.request('/api/payments/polar/webhook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'webhook-id': eventId,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signature}`,
    },
  });
}
const outcomes = (orderId, subject) =>
  trace.filter((e) => e.payload.orderId === orderId && e.subject === subject);

test('Polar, PostgreSQL, NATS, Inventory y Notifications completan la saga', async (t) => {
  try {
    await t.test(
      'Catalog pendiente impide reservar; edición posterior no cambia el precio guardado',
      async () => {
        const product = await catalog.createProduct({
          title: 'Precio estable',
          description: 'Prueba',
          price: 10.25,
          stock: 10,
          image: new File(['fixture'], 'test.png'),
        });
        const request = () =>
          app.request('/api/orders', {
            method: 'POST',
            headers: { authorization: 'Bearer buyer', 'content-type': 'application/json' },
            body: JSON.stringify({
              productId: product.id,
              quantity: 2,
              currency: 'usd',
              amount: 1,
            }),
          });
        assert.equal((await request()).status, 409);
        assert.equal(
          (await pool.query('SELECT 1 FROM orders_order WHERE product_id=$1', [product.id]))
            .rowCount,
          0,
        );
        assert.equal(await catalog.getAvailableStock(product.id), 10);
        await productWorker.tick();
        const response = await request();
        assert.equal(response.status, 202);
        const { order } = await response.json();
        await until(
          async () =>
            (
              await pool.query('SELECT 1 FROM orders_payment_checkout WHERE order_id=$1', [
                order.id,
              ])
            ).rowCount === 1,
        );
        await catalog.updateProduct(product.id, {
          title: 'Nuevo precio',
          description: 'Actualizado',
          price: 12.75,
          stock: 8,
        });
        await productWorker.tick();
        await worker.tick();
        assert.equal((await worker.getCheckout(order.id)).checkout.amount, 2050);
        assert.equal((await catalog.getBillingProduct(product.id)).product.unitAmount, 1275);
        assert.equal(polarProducts.get(product.id).unitAmount, 1275);
        await deliver(eventFor(order, 'order.paid', 'paid'));
        await worker.tick();
        await until(async () => (await service.getOrder(order.id)).status === 'confirmed');
        assert.equal(await catalog.getAvailableStock(product.id), 8);
      },
    );
    await t.test(
      'éxito, duplicados concurrentes y eventos tardíos mantienen confirmación y stock',
      async () => {
        const order = await createOrder();
        assert.equal(stock.get(order.productId), 8);
        assert.equal((await service.getOrder(order.id)).status, 'pending');
        const checkout = await app.request(`/api/orders/${order.id}/checkout`, {
          headers: { authorization: 'Bearer buyer' },
        });
        assert.equal(checkout.status, 200);
        assert.equal(checkout.headers.get('cache-control'), 'no-store');
        const checkoutData = await checkout.json();
        assert.equal(checkoutData.checkout.amount, 4000);
        assert.equal(checkoutData.checkout.currency, 'pen');
        const paid = eventFor(order, 'order.paid', 'paid');
        const eventId = randomUUID();
        for (const response of await Promise.all(
          Array.from({ length: 4 }, () => deliver(paid, eventId)),
        ))
          assert.equal(response.status, 202);
        const secondWorker = createPaymentWorker(pool, publisher, gateway);
        await Promise.all([worker.tick(), secondWorker.tick()]);
        await until(async () => (await service.getOrder(order.id)).status === 'confirmed');
        await deliver(paid); // distinto event id del mismo recurso, terminal ya aplicado
        await worker.tick();
        await deliver(eventFor(order, 'checkout.expired', 'expired'));
        await worker.tick();
        await delay(100);
        assert.equal(outcomes(order.id, eventSubjects.paymentSucceeded).length, 1);
        assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 0);
        assert.equal(stock.get(order.productId), 8);
        assert.equal(
          outcomes(order.id, eventSubjects.paymentSucceeded)[0].payload.checkoutId,
          paid.data.checkout_id,
        );
        assert.equal(
          outcomes(order.id, eventSubjects.paymentSucceeded)[0].payload.eventId,
          eventId,
        );
        const reserved = outcomes(order.id, eventSubjects.inventoryReserved)[0].payload;
        const before = creations;
        await worker.onInventoryReserved(reserved);
        await worker.tick();
        assert.equal(creations, before);
      },
    );
    for (const [type, status, reason] of [
      ['checkout.updated', 'failed', 'polar_checkout_failed'],
      ['checkout.expired', 'expired', 'polar_checkout_expired'],
      ['order.updated', 'void', 'polar_order_void'],
    ])
      await t.test(`${status} rechaza y libera una sola vez`, async () => {
        const order = await createOrder();
        const eventId = randomUUID();
        const failure = eventFor(order, type, status);
        await deliver(failure, eventId);
        await deliver(failure, eventId);
        await worker.tick();
        await until(
          async () =>
            (await service.getOrder(order.id)).status === 'rejected' &&
            stock.get(order.productId) === 10 &&
            outcomes(order.id, eventSubjects.inventoryReleased).length === 1,
        );
        await deliver(eventFor(order, 'order.paid', 'paid'));
        await worker.tick();
        await delay(100);
        assert.equal((await service.getOrder(order.id)).rejectionReason, reason);
        assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 1);
        assert.equal(outcomes(order.id, eventSubjects.inventoryReleased).length, 1);
        assert.equal(
          outcomes(order.id, eventSubjects.inventoryReleased)[0].payload.eventId,
          eventId,
        );
      });
    await t.test(
      'firma inválida no persiste y compradores ajenos no leen enlaces de pago',
      async () => {
        const order = await createOrder();
        assert.equal(
          (await app.request('/api/payments/polar/webhook', { method: 'POST', body: '{}' })).status,
          403,
        );
        const outsiderRoutes = createOrdersModule(
          bus,
          { getSession: async () => ({ user: { id: 'outsider' } }) },
          worker,
          catalogBilling,
        ).routes;
        assert.equal((await outsiderRoutes.request(`/${order.id}/checkout`)).status, 404);
        assert.equal((await app.request(`/api/orders/${order.id}/checkout`)).status, 401);
      },
    );
    await t.test('checkout ajeno o importe incorrecto no confirma ni libera stock', async () => {
      const order = await createOrder();
      const wrongCheckout = eventFor(order, 'order.paid', 'paid');
      wrongCheckout.data.checkout_id = randomUUID();
      await deliver(wrongCheckout);
      await worker.tick();
      const wrongAmount = eventFor(order, 'order.paid', 'paid');
      wrongAmount.data.subtotal_amount = 1;
      await deliver(wrongAmount);
      await worker.tick();
      const wrongCurrency = eventFor(order, 'order.paid', 'paid');
      wrongCurrency.data.currency = 'usd';
      await deliver(wrongCurrency);
      await worker.tick();
      assert.equal((await service.getOrder(order.id)).status, 'pending');
      assert.equal(stock.get(order.productId), 8);
    });
    await t.test('fallo de NATS reintenta desde inbox después de reiniciar worker', async () => {
      const order = await createOrder();
      const eventId = randomUUID();
      await deliver(eventFor(order, 'order.paid', 'paid'), eventId);
      failPublish = true;
      await worker.tick();
      assert.equal(
        (
          await pool.query('SELECT processed_at FROM orders_payment_webhook WHERE event_id=$1', [
            eventId,
          ])
        ).rows[0].processed_at,
        null,
      );
      await pool.query(
        'UPDATE orders_payment_webhook SET next_attempt_at=now() WHERE event_id=$1',
        [eventId],
      );
      worker = createPaymentWorker(pool, publisher, gateway);
      await worker.tick();
      await until(async () => (await service.getOrder(order.id)).status === 'confirmed');
      assert.equal(outcomes(order.id, eventSubjects.paymentSucceeded).length, 1);
    });
    await t.test(
      'creación incierta recupera sesión por metadata sin emitir otro POST',
      async () => {
        uncertain = true;
        const order = await createOrder();
        uncertain = false;
        const before = creations;
        await pool.query(
          'UPDATE orders_payment_checkout SET next_attempt_at=now() WHERE order_id=$1',
          [order.id],
        );
        worker = createPaymentWorker(pool, publisher, gateway);
        await worker.tick();
        assert.equal((await worker.getCheckout(order.id)).checkout.id, sessions.get(order.id).id);
        assert.equal(creations, before);
      },
    );
    await t.test(
      'rechazo definitivo de Checkout API compensa y Notifications acepta contratos v1',
      async () => {
        rejected = true;
        const order = await createOrder();
        rejected = false;
        await worker.tick();
        await until(
          async () =>
            (await service.getOrder(order.id)).status === 'rejected' &&
            stock.get(order.productId) === 10 &&
            outcomes(order.id, eventSubjects.inventoryReleased).length === 1,
        );
        await until(() => notificationResults.length >= 6);
        assert.ok(notificationResults.every((result) => result.statusCode === 202));
      },
    );
  } finally {
    await worker.stop();
    await productWorker.stop();
    await bus.close();
    await new Promise((resolve) => catalogServer.close(resolve));
    await closeCatalogDb();
    await closeDb();
    await closeInventoryDb();
    await base.query(`DROP SCHEMA ${schema} CASCADE`);
    await base.end();
  }
});
