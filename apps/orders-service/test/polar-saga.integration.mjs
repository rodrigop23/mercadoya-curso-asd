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
process.env.ORDER_PENDING_TTL_MINUTES = '15';
process.env.ORDER_EXPIRY_GRACE_SECONDS = '120';
process.env.POLAR_GET_TIMEOUT_MS = '5000';
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
await pool.query(await readFile(new URL('../db/0003_cart.sql', import.meta.url), 'utf8'));
await pool.query(
  await readFile(new URL('../db/0004_purchase_product.sql', import.meta.url), 'utf8'),
);
await pool.query(
  await readFile(new URL('../db/0005_order_lifecycle.sql', import.meta.url), 'utf8'),
);
await pool.query(
  await readFile(
    new URL('../../catalog-service/drizzle/0003_cart_stock.sql', import.meta.url),
    'utf8',
  ),
);
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
  processProductImage: async () => ({ imagePath: 'media/test-full.webp' }),
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
const bundles = new Map();
const purchaseProducts = new Map();
let productCreations = 0;
let uncertainProduct = false;
let hiddenProduct = false;
let creations = 0;
let uncertain = false;
let rejected = false;
let failPublish = false;
const gateway = {
  server: 'sandbox',
  async createPurchaseProduct() {
    productCreations++;
    const id = randomUUID();
    purchaseProducts.set(this.server, id);
    if (uncertainProduct) throw new Error('product_network_uncertain');
    return id;
  },
  async findPurchaseProduct() {
    return hiddenProduct ? null : (purchaseProducts.get(this.server) ?? null);
  },
  async findBundle(event) {
    return bundles.get(event.orderId)?.id ?? null;
  },
  async create(event, product, items, bundleId) {
    assert.equal(product.currency, 'pen');
    assert.equal(product.productId, event.productId);
    if (event.items)
      assert.equal(bundleId, bundles.get(event.orderId)?.id ?? purchaseProducts.get(this.server));
    creations++;
    if (rejected) throw new CheckoutRejected('polar_checkout_rejected');
    const session = {
      id: randomUUID(),
      url: 'https://sandbox.polar.sh/checkout/test',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      amount: event.items
        ? items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0)
        : product.unitAmount * event.quantity,
      currency: 'pen',
      status: 'open',
    };
    sessions.set(event.orderId, session);
    if (uncertain) throw new Error('network_uncertain');
    return session;
  },
  async get(checkoutId) {
    const checkout = [...sessions.values()].find((session) => session.id === checkoutId);
    if (!checkout || checkout.unavailable) throw new Error('polar_unavailable');
    return checkout;
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
    cancelOrder: (...args) => worker.cancelOrder(...args),
  },
  catalogBilling,
);
const service = createOrdersService(bus, catalogBilling);
const inventory = createInventoryModule(
  {
    async adjustStockBatch(input) {
      const result = await catalogStock.adjustStockBatch(input);
      for (const item of input.adjustments)
        stock.set(item.productId, await catalogStock.getAvailableStock(item.productId));
      return result;
    },
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
async function cartProducts() {
  const products = [];
  for (const [title, price] of [
    ['Palta de prueba', 10],
    ['Tomate de prueba', 7],
  ]) {
    const product = await catalog.createProduct({
      title,
      description: 'Producto de carrito',
      price,
      stock: 10,
      image: new File(['fixture'], 'test.png'),
    });
    products.push(product);
    await productWorker.tick();
  }
  return products;
}
async function postCart(items, idempotencyKey = randomUUID()) {
  const response = await app.request('/api/orders', {
    method: 'POST',
    headers: { authorization: 'Bearer buyer', 'content-type': 'application/json' },
    body: JSON.stringify({ items, idempotencyKey, totalAmount: 1, currency: 'usd' }),
  });
  assert.equal(response.status, 202);
  return (await response.json()).order;
}
async function createCart(quantities = [2, 3], beforeTick = async () => {}) {
  const products = await cartProducts();
  const items = products.map((product, index) => ({
    productId: product.id,
    quantity: quantities[index],
  }));
  const order = await postCart(items);
  await until(
    async () =>
      (await pool.query('SELECT 1 FROM orders_payment_checkout WHERE order_id=$1', [order.id]))
        .rowCount === 1,
  );
  await beforeTick(order);
  await worker.tick();
  return { order, products, items };
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
      'respuesta perdida del producto compartido bloquea nuevos POST y recupera dos pedidos con importes distintos',
      async () => {
        uncertainProduct = true;
        hiddenProduct = true;
        const first = await createCart();
        uncertainProduct = false;
        const second = await createCart([1, 1]);
        assert.equal(productCreations, 1);
        assert.equal((await worker.getCheckout(first.order.id)).checkout, null);
        assert.equal((await worker.getCheckout(second.order.id)).checkout, null);
        hiddenProduct = false;
        await pool.query(
          'UPDATE orders_payment_checkout SET next_attempt_at=now() WHERE order_id=ANY($1::uuid[])',
          [[first.order.id, second.order.id]],
        );
        worker = createPaymentWorker(pool, publisher, gateway);
        const replica = createPaymentWorker(pool, publisher, gateway);
        await Promise.all([worker.tick(), replica.tick()]);
        await worker.tick();
        assert.equal((await worker.getCheckout(first.order.id)).checkout.amount, 4100);
        assert.equal((await worker.getCheckout(second.order.id)).checkout.amount, 1700);
        assert.equal(productCreations, 1);
        const references = await pool.query(
          'SELECT bundle_product_id FROM orders_payment_checkout WHERE order_id=ANY($1::uuid[])',
          [[first.order.id, second.order.id]],
        );
        assert.deepEqual(
          references.rows.map((row) => row.bundle_product_id),
          [purchaseProducts.get('sandbox'), purchaseProducts.get('sandbox')],
        );
      },
    );
    await t.test(
      'carrito conserva desglose y miniaturas, cobra todo y confirma una sola orden',
      async () => {
        const { order, products, items } = await createCart();
        assert.equal(order.totalAmount, 4100);
        assert.equal(order.items.length, 2);
        assert.equal(order.items[0].thumbnailPath, 'media/test-thumb.webp');
        assert.equal('polarProductId' in order.items[0], false);
        assert.equal((await worker.getCheckout(order.id)).checkout.amount, 4100);
        assert.equal(await catalog.getAvailableStock(products[0].id), 8);
        assert.equal(await catalog.getAvailableStock(products[1].id), 7);
        const reserved = outcomes(order.id, eventSubjects.inventoryReserved)[0].payload;
        await inventory.onOrderPlaced({ ...reserved });
        await catalog.updateProduct(products[0].id, {
          title: 'Título cambiado',
          description: 'Cambió',
          price: 15,
          stock: 8,
        });
        await productWorker.tick();
        const again = await postCart(items, order.id);
        assert.equal(again.id, order.id);
        assert.equal(again.totalAmount, 4100);
        assert.equal(again.items[0].title, 'Palta de prueba');
        assert.equal(await catalog.getAvailableStock(products[0].id), 8);
        await deliver(eventFor(order, 'order.paid', 'paid'));
        await worker.tick();
        await until(async () => (await service.getOrder(order.id)).status === 'confirmed');
        assert.deepEqual(
          outcomes(order.id, eventSubjects.paymentSucceeded)[0].payload.items,
          items,
        );
        assert.equal((await service.getOrder(order.id)).items[0].unitAmount, 1000);
        const other = createOrdersModule(
          bus,
          { getSession: async () => ({ user: { id: 'other' } }) },
          worker,
          catalogBilling,
        ).routes;
        assert.equal((await other.request(`/${order.id}`)).status, 404);
        assert.equal((await other.request(`/${order.id}/checkout`)).status, 404);
      },
    );
    await t.test('sin stock en una línea no reserva ningún producto del carrito', async () => {
      const products = await cartProducts();
      const order = await postCart([
        { productId: products[0].id, quantity: 2 },
        { productId: products[1].id, quantity: 11 },
      ]);
      await until(async () => (await service.getOrder(order.id)).status === 'rejected');
      for (const product of products) assert.equal(await catalog.getAvailableStock(product.id), 10);
      assert.equal((await worker.getCheckout(order.id)).checkout, null);
      assert.equal(outcomes(order.id, eventSubjects.inventoryReserved).length, 0);
    });
    await t.test(
      'fallo de carrito restaura todas las líneas una sola vez y no vuelve a reservar',
      async () => {
        const { order, products } = await createCart();
        const failure = eventFor(order, 'checkout.expired', 'expired');
        await deliver(failure);
        await worker.tick();
        await until(
          async () =>
            (await service.getOrder(order.id)).status === 'rejected' &&
            (await catalog.getAvailableStock(products[0].id)) === 10,
        );
        await inventory.onPaymentFailed(outcomes(order.id, eventSubjects.paymentFailed)[0].payload);
        for (const product of products)
          assert.equal(await catalog.getAvailableStock(product.id), 10);
        assert.equal(outcomes(order.id, eventSubjects.inventoryReleased).length, 1);
        await inventory.onOrderPlaced(
          outcomes(order.id, eventSubjects.inventoryReserved)[0].payload,
        );
        for (const product of products)
          assert.equal(await catalog.getAvailableStock(product.id), 10);
      },
    );
    await t.test(
      'producto privado de un pedido anterior se recupera sin crear otro producto',
      async () => {
        const beforeProducts = productCreations;
        const legacyProductId = randomUUID();
        const { order } = await createCart([2, 3], async (order) => {
          bundles.set(order.id, { id: legacyProductId });
          await pool.query(
            "UPDATE orders_payment_checkout SET bundle_state='creating' WHERE order_id=$1",
            [order.id],
          );
        });
        assert.equal(productCreations, beforeProducts);
        assert.equal((await worker.getCheckout(order.id)).checkout.amount, 4100);
        const reference = await pool.query(
          'SELECT bundle_product_id FROM orders_payment_checkout WHERE order_id=$1',
          [order.id],
        );
        assert.equal(reference.rows[0].bundle_product_id, legacyProductId);
      },
    );
    await t.test('sandbox y producción conservan referencias de producto separadas', async () => {
      const beforeProducts = productCreations;
      try {
        const { order } = await createCart([1, 1], async () => {
          worker = createPaymentWorker(pool, publisher, { ...gateway, server: 'production' });
        });
        assert.equal((await worker.getCheckout(order.id)).checkout.amount, 1700);
        assert.equal(productCreations, beforeProducts + 1);
        assert.notEqual(purchaseProducts.get('sandbox'), purchaseProducts.get('production'));
        const registry = await pool.query('SELECT server, product_id FROM orders_payment_product');
        assert.equal(registry.rows.length, 2);
        for (const row of registry.rows)
          assert.equal(row.product_id, purchaseProducts.get(row.server));
      } finally {
        worker = createPaymentWorker(pool, publisher, gateway);
      }
    });
    await t.test(
      'ajuste de carrito es atómico e idempotente también con llamadas concurrentes',
      async () => {
        const products = await cartProducts();
        const adjustments = products.map((product) => ({ productId: product.id, delta: -7 }));
        const operationId = `cart-test:${randomUUID()}`;
        const results = await Promise.all(
          Array.from({ length: 3 }, () =>
            catalogStock.adjustStockBatch({ operationId, adjustments }),
          ),
        );
        assert.ok(results.every((result) => result.adjusted));
        for (const product of products)
          assert.equal(await catalog.getAvailableStock(product.id), 3);
        const competing = await Promise.all(
          Array.from({ length: 2 }, () =>
            catalogStock.adjustStockBatch({
              operationId: randomUUID(),
              adjustments: adjustments.map((item) => ({ ...item, delta: -2 })),
            }),
          ),
        );
        assert.equal(competing.filter((result) => result.adjusted).length, 1);
        for (const product of products)
          assert.equal(await catalog.getAvailableStock(product.id), 1);
      },
    );
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
    await t.test(
      'migración rellena pendientes anteriores con TTL configurado y no cambia un plazo existente',
      async () => {
        const products = await cartProducts();
        const quiet = createOrdersService({ ...bus, publish: async () => {} }, catalogBilling);
        const { order } = await quiet.createOrder({
          buyerId,
          productId: products[0].id,
          quantity: 1,
        });
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "UPDATE orders_order SET expires_at=NULL, created_at=(now() AT TIME ZONE 'UTC')-interval '1 hour' WHERE id=$1",
            [order.id],
          );
          await client.query("SELECT set_config('mercadoya.order_pending_ttl_minutes', '3', true)");
          const migration = await readFile(
            new URL('../db/0005_order_lifecycle.sql', import.meta.url),
            'utf8',
          );
          await client.query(migration);
          const read = async () =>
            (
              await client.query(
                "SELECT expires_at, extract(epoch FROM expires_at-(created_at AT TIME ZONE 'UTC'))::integer AS seconds FROM orders_order WHERE id=$1",
                [order.id],
              )
            ).rows[0];
          const before = await read();
          assert.equal(before.seconds, 180);
          await client.query(
            "SELECT set_config('mercadoya.order_pending_ttl_minutes', '20', true)",
          );
          await client.query(migration);
          assert.deepEqual(await read(), before);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        await worker.tick();
        assert.equal((await service.getOrder(order.id)).status, 'expired');
        assert.equal(
          (await pool.query('SELECT 1 FROM orders_payment_checkout WHERE order_id=$1', [order.id]))
            .rowCount,
          0,
        );
      },
    );
    const cancel = (orderId) =>
      app.request(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { authorization: 'Bearer buyer' },
      });
    const compensated = async (order, expected) => {
      await until(
        async () =>
          (await service.getOrder(order.id)).status === expected &&
          outcomes(order.id, eventSubjects.inventoryReleased).length === 1,
      );
      assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 1);
      assert.equal(outcomes(order.id, eventSubjects.paymentSucceeded).length, 0);
    };
    for (const cart of [false, true])
      await t.test(
        `cancelar checkout abierto devuelve stock de ${cart ? 'carrito' : 'producto único'}`,
        async () => {
          const fixture = cart ? await createCart() : { order: await createOrder() };
          const { order } = fixture;
          const before = await service.getOrder(order.id);
          assert.equal(
            new Date(before.expiresAt).getTime(),
            Date.parse(sessions.get(order.id).expires_at) + 120000,
          );
          const response = await cancel(order.id);
          assert.equal(response.status, 202);
          const closed = (await response.json()).order;
          assert.equal(closed.status, 'cancelled');
          assert.equal(closed.rejectionReason, 'order_cancelled');
          assert.ok(closed.cancelledAt);
          assert.equal((await worker.getCheckout(order.id)).checkout, null);
          assert.equal((await cancel(order.id)).status, 200);
          await worker.tick();
          await compensated(order, 'cancelled');
          for (const id of fixture.products?.map((product) => product.id) ?? [order.productId])
            assert.equal(await catalog.getAvailableStock(id), 10);
          const reservation = outcomes(order.id, eventSubjects.inventoryReserved)[0].payload;
          await inventory.onOrderPlaced(reservation);
          await worker.onInventoryReserved(reservation);
          await worker.tick();
          await orders.onPaymentFailed({ orderId: order.id, reason: 'payment_failed' });
          await orders.onInventoryReleased({ orderId: order.id });
          assert.equal((await service.getOrder(order.id)).status, 'cancelled');
          assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 1);
          assert.equal(outcomes(order.id, eventSubjects.inventoryReleased).length, 1);
          const row = (
            await pool.query('SELECT released_at FROM inventory_reservations WHERE order_id=$1', [
              order.id,
            ])
          ).rows[0];
          assert.ok(row.released_at);
        },
      );
    for (const cart of [false, true])
      await t.test(
        `vencer sin webhook devuelve stock de ${cart ? 'carrito' : 'producto único'}`,
        async () => {
          const fixture = cart ? await createCart() : { order: await createOrder() };
          const { order } = fixture;
          await pool.query(
            "UPDATE orders_order SET expires_at=now()-interval '1 second' WHERE id=$1",
            [order.id],
          );
          await worker.tick();
          await worker.tick();
          await compensated(order, 'expired');
          assert.equal((await service.getOrder(order.id)).rejectionReason, 'order_expired');
          assert.equal((await service.getOrder(order.id)).cancelledAt, null);
          await orders.onPaymentFailed({ orderId: order.id, reason: 'payment_failed' });
          await orders.onInventoryReleased({ orderId: order.id });
          assert.equal((await service.getOrder(order.id)).status, 'expired');
          for (const id of fixture.products?.map((product) => product.id) ?? [order.productId])
            assert.equal(await catalog.getAvailableStock(id), 10);
        },
      );
    for (const finalStatus of ['cancelled', 'expired'])
      await t.test(
        `${finalStatus} antes de la reserva compensa inventory.reserved tardío`,
        async () => {
          const products = await cartProducts();
          const quiet = createOrdersService({ ...bus, publish: async () => {} }, catalogBilling);
          const { order } = await quiet.createOrder({
            buyerId,
            items: products.map((product) => ({ productId: product.id, quantity: 2 })),
          });
          assert.equal(
            new Date(order.expiresAt).getTime() - new Date(order.createdAt).getTime(),
            900000,
          );
          if (finalStatus === 'cancelled') assert.equal((await cancel(order.id)).status, 202);
          else {
            await pool.query(
              "UPDATE orders_order SET expires_at=now()-interval '1 second' WHERE id=$1",
              [order.id],
            );
            await worker.tick();
          }
          assert.equal(
            (
              await pool.query('SELECT 1 FROM orders_payment_checkout WHERE order_id=$1', [
                order.id,
              ])
            ).rowCount,
            0,
          );
          assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 0);
          let republished = 0;
          const retry = createOrdersService(
            {
              ...bus,
              publish: async () => {
                republished++;
              },
            },
            catalogBilling,
          );
          await retry.createOrder({
            buyerId,
            idempotencyKey: order.id,
            items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
          });
          assert.equal(republished, 0);
          await inventory.onOrderPlaced({
            version: 1,
            orderId: order.id,
            productId: order.productId,
            quantity: order.quantity,
            buyerId: order.buyerId,
            items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
            occurredAt: new Date().toISOString(),
          });
          await until(
            async () =>
              (
                await pool.query('SELECT 1 FROM orders_payment_checkout WHERE order_id=$1', [
                  order.id,
                ])
              ).rowCount === 1,
          );
          const before = creations;
          await worker.tick();
          await compensated(order, finalStatus);
          assert.equal(creations, before);
          for (const product of products)
            assert.equal(await catalog.getAvailableStock(product.id), 10);
        },
      );
    for (const finalStatus of ['cancelled', 'expired'])
      await t.test(
        `pago después de ${finalStatus} queda en late_payment sin confirmar`,
        async () => {
          const order = await createOrder();
          if (finalStatus === 'cancelled') await cancel(order.id);
          else
            await pool.query(
              "UPDATE orders_order SET expires_at=now()-interval '1 second' WHERE id=$1",
              [order.id],
            );
          await worker.tick();
          await worker.tick();
          await compensated(order, finalStatus);
          const paid = eventFor(order, 'order.paid', 'paid');
          const bad = structuredClone(paid);
          bad.data.subtotal_amount = 1;
          await deliver(bad);
          await worker.tick();
          assert.equal(
            (
              await pool.query(
                'SELECT late_payment FROM orders_payment_checkout WHERE order_id=$1',
                [order.id],
              )
            ).rows[0].late_payment,
            null,
          );
          const eventId = randomUUID();
          await deliver(paid, eventId);
          await worker.tick();
          await deliver(paid, eventId);
          await worker.tick();
          const late = (
            await pool.query('SELECT late_payment FROM orders_payment_checkout WHERE order_id=$1', [
              order.id,
            ])
          ).rows[0].late_payment;
          assert.equal(late.eventId, eventId);
          assert.equal(late.providerOrderId, paid.data.id);
          assert.equal(late.amount, paid.data.subtotal_amount);
          assert.equal(late.occurredAt, paid.timestamp);
          assert.equal((await service.getOrder(order.id)).status, finalStatus);
          assert.equal(await catalog.getAvailableStock(order.productId), 10);
          assert.equal(outcomes(order.id, eventSubjects.paymentSucceeded).length, 0);
        },
      );
    await t.test(
      'Polar confirmed o succeeded impide cancelar; caída de Polar devuelve 503',
      async () => {
        const order = await createOrder();
        const checkout = sessions.get(order.id);
        for (const status of ['confirmed', 'succeeded']) {
          checkout.status = status;
          const response = await cancel(order.id);
          assert.equal(response.status, 409);
          assert.deepEqual(await response.json(), { error: 'El pago se está procesando' });
        }
        checkout.status = 'unknown';
        assert.equal((await cancel(order.id)).status, 503);
        checkout.status = 'open';
        checkout.unavailable = true;
        assert.equal((await cancel(order.id)).status, 503);
        assert.equal((await service.getOrder(order.id)).status, 'pending');
        assert.equal(await catalog.getAvailableStock(order.productId), 8);
        assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 0);
        checkout.unavailable = false;
        const other = createOrdersModule(
          bus,
          { getSession: async () => ({ user: { id: 'other' } }) },
          worker,
          catalogBilling,
        ).routes;
        assert.equal((await other.request(`/${order.id}/cancel`, { method: 'POST' })).status, 404);
      },
    );
    await t.test(
      'publicación perdida devuelve 503 y el reintento republica una vez y reserva una vez',
      async () => {
        const products = await cartProducts();
        let fail = true;
        const sent = [];
        const retryBus = {
          ...bus,
          publish: async (subject, payload) => {
            sent.push({ subject, payload });
            if (fail) throw new Error('nats_unavailable');
            await bus.publish(subject, payload);
          },
        };
        const route = createOrdersModule(retryBus, identity, worker, catalogBilling).routes;
        const id = randomUUID();
        const request = () =>
          route.request('/', {
            method: 'POST',
            headers: { authorization: 'Bearer buyer', 'content-type': 'application/json' },
            body: JSON.stringify({
              items: products.map((product) => ({ productId: product.id, quantity: 2 })),
              idempotencyKey: id,
            }),
          });
        assert.equal((await request()).status, 503);
        assert.equal((await request()).status, 503);
        assert.equal((await service.getOrder(id)).status, 'pending');
        fail = false;
        assert.equal((await request()).status, 202);
        await until(
          async () =>
            (await pool.query('SELECT 1 FROM orders_payment_checkout WHERE order_id=$1', [id]))
              .rowCount === 1,
        );
        assert.equal((await request()).status, 202);
        await worker.tick();
        assert.equal(sent.length, 3);
        assert.deepEqual(sent[0], sent[2]);
        for (const product of products)
          assert.equal(await catalog.getAvailableStock(product.id), 8);
        assert.equal(
          (await pool.query('SELECT 1 FROM inventory_reservations WHERE order_id=$1', [id]))
            .rowCount,
          1,
        );
      },
    );
    for (const expire of [false, true])
      await t.test(
        `cancelaciones concurrentes${expire ? ' y vencimiento simultáneo' : ''} compensan una sola vez`,
        async () => {
          const order = await createOrder();
          if (expire)
            await pool.query(
              "UPDATE orders_order SET expires_at=now()-interval '1 second' WHERE id=$1",
              [order.id],
            );
          const results = await Promise.all([
            cancel(order.id),
            cancel(order.id),
            cancel(order.id),
            ...(expire ? [worker.tick()] : []),
          ]);
          for (const response of results.filter(Boolean))
            assert.ok([200, 202, 409].includes(response.status));
          await worker.tick();
          await worker.tick();
          const status = (await service.getOrder(order.id)).status;
          assert.ok(['cancelled', 'expired'].includes(status));
          await compensated(order, status);
          assert.equal(await catalog.getAvailableStock(order.productId), 10);
          assert.equal(
            (
              await pool.query(
                "SELECT 1 FROM orders_payment_webhook WHERE outcome->>'orderId'=$1",
                [order.id],
              )
            ).rowCount,
            1,
          );
        },
      );
    await t.test('creating incierto deja de buscar y devuelve stock cuando vence', async () => {
      uncertain = true;
      const order = await createOrder();
      uncertain = false;
      let finds = 0;
      const expiryWorker = createPaymentWorker(pool, publisher, {
        ...gateway,
        find: async () => {
          finds++;
          return null;
        },
      });
      await pool.query("UPDATE orders_order SET expires_at=now()-interval '1 second' WHERE id=$1", [
        order.id,
      ]);
      await pool.query(
        'UPDATE orders_payment_checkout SET next_attempt_at=now() WHERE order_id=$1',
        [order.id],
      );
      await expiryWorker.tick();
      await expiryWorker.tick();
      await compensated(order, 'expired');
      assert.equal(finds, 0);
    });
    for (const mode of ['lento', 'colgado'])
      await t.test(
        `GET Polar ${mode} termina en 503 y permite procesar pagos y vencimientos durante la espera`,
        { timeout: 8000 },
        async () => {
          const order = await createOrder();
          const other = await createOrder();
          const expired = await createOrder();
          await pool.query(
            "UPDATE orders_order SET expires_at=now()-interval '1 second' WHERE id=$1",
            [expired.id],
          );
          const started = Promise.withResolvers();
          const remote = Promise.withResolvers();
          let passedTimeout;
          process.env.POLAR_GET_TIMEOUT_MS = '2000';
          const slowWorker = createPaymentWorker(pool, publisher, {
            ...gateway,
            async get(id, timeoutMs) {
              passedTimeout = timeoutMs;
              started.resolve();
              if (mode === 'colgado') return new Promise(() => {});
              await remote.promise;
              return gateway.get(id);
            },
          });
          process.env.POLAR_GET_TIMEOUT_MS = '5000';
          const route = createOrdersModule(bus, identity, slowWorker, catalogBilling).routes;
          let replied = false;
          const start = performance.now();
          const response = route
            .request(`/${order.id}/cancel`, {
              method: 'POST',
              headers: { authorization: 'Bearer buyer' },
            })
            .then((value) => {
              replied = true;
              return value;
            });
          try {
            await started.promise;
            // Un outcome del mismo pedido obligaría al tick a esperar su fila si cancelar la bloqueara.
            await deliver(eventFor(order, 'order.paid', 'paid'));
            await deliver(eventFor(other, 'order.paid', 'paid'));
            await worker.tick();
            await worker.tick();
            assert.equal((await service.getOrder(order.id)).status, 'confirmed');
            assert.equal((await service.getOrder(other.id)).status, 'confirmed');
            assert.equal((await service.getOrder(expired.id)).status, 'expired');
            assert.equal(replied, false);
            const result = await response;
            assert.equal(result.status, 503);
            assert.equal(passedTimeout, 2000);
            assert.ok(
              performance.now() - start < 3000,
              'La cancelación debe terminar con el timeout, sin esperar a Polar.',
            );
            assert.equal((await service.getOrder(order.id)).cancelledAt, null);
            assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 0);
            await worker.tick();
            await compensated(expired, 'expired');
          } finally {
            remote.resolve();
            process.env.POLAR_GET_TIMEOUT_MS = '5000';
          }
        },
      );
    for (const change of ['checkout_id', 'state'])
      await t.test(
        `cambiar ${change} después del GET y antes del lock impide cerrar el pedido`,
        async () => {
          const order = await createOrder();
          const checkoutId = sessions.get(order.id).id;
          const changedId = randomUUID();
          const racingWorker = createPaymentWorker(pool, publisher, {
            ...gateway,
            async get(id) {
              const checkout = await gateway.get(id);
              if (change === 'checkout_id')
                await pool.query(
                  'UPDATE orders_payment_checkout SET checkout_id=$2 WHERE order_id=$1',
                  [order.id, changedId],
                );
              else
                await pool.query(
                  "UPDATE orders_payment_checkout SET state='creating' WHERE order_id=$1",
                  [order.id],
                );
              return checkout;
            },
          });
          const route = createOrdersModule(bus, identity, racingWorker, catalogBilling).routes;
          try {
            const response = await route.request(`/${order.id}/cancel`, {
              method: 'POST',
              headers: { authorization: 'Bearer buyer' },
            });
            assert.equal(response.status, 409);
            assert.match((await response.json()).error, /El pago cambió/);
            assert.equal((await service.getOrder(order.id)).status, 'pending');
            assert.equal((await service.getOrder(order.id)).cancelledAt, null);
            assert.equal(
              (
                await pool.query('SELECT 1 FROM orders_payment_webhook WHERE event_id=$1', [
                  `order-cancel:${order.id}`,
                ])
              ).rowCount,
              0,
            );
            assert.equal(await catalog.getAvailableStock(order.productId), 8);
          } finally {
            await pool.query(
              "UPDATE orders_payment_checkout SET checkout_id=$2, state='open' WHERE order_id=$1",
              [order.id, checkoutId],
            );
          }
        },
      );
    await t.test(
      'el pedido que se confirma durante el GET conserva su estado y no se cancela',
      async () => {
        const order = await createOrder();
        const racingWorker = createPaymentWorker(pool, publisher, {
          ...gateway,
          async get(id) {
            const checkout = await gateway.get(id);
            await deliver(eventFor(order, 'order.paid', 'paid'));
            await worker.tick();
            return checkout;
          },
        });
        const route = createOrdersModule(bus, identity, racingWorker, catalogBilling).routes;
        const response = await route.request(`/${order.id}/cancel`, {
          method: 'POST',
          headers: { authorization: 'Bearer buyer' },
        });
        assert.equal(response.status, 409);
        assert.equal((await service.getOrder(order.id)).status, 'confirmed');
        assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 0);
      },
    );
    await t.test(
      'un pendiente vencido con checkout succeeded se registra y no bloquea otro vencimiento',
      async (subtest) => {
        const paid = await createOrder();
        const normal = await createOrder();
        await pool.query("UPDATE orders_payment_checkout SET state='succeeded' WHERE order_id=$1", [
          paid.id,
        ]);
        await pool.query(
          "UPDATE orders_order SET expires_at=now()-interval '10 minutes' WHERE id=$1",
          [paid.id],
        );
        await pool.query(
          "UPDATE orders_order SET expires_at=now()-interval '1 minute' WHERE id=$1",
          [normal.id],
        );
        const logs = [];
        subtest.mock.method(console, 'info', (line) => logs.push(JSON.parse(line)));
        await worker.tick();
        assert.equal((await service.getOrder(paid.id)).status, 'pending');
        assert.equal((await service.getOrder(normal.id)).status, 'expired');
        assert.ok(
          logs.some(
            (event) => event.type === 'order.expiry_skipped_paid' && event.orderId === paid.id,
          ),
        );
        assert.equal(outcomes(paid.id, eventSubjects.paymentFailed).length, 0);
        assert.equal(outcomes(paid.id, eventSubjects.paymentSucceeded).length, 0);
        await worker.tick();
        await compensated(normal, 'expired');
        assert.equal(await catalog.getAvailableStock(paid.productId), 8);
        const warningCount = (orderId) =>
          logs.filter(
            (event) => event.type === 'order.expiry_skipped_paid' && event.orderId === orderId,
          ).length;
        await worker.tick();
        await worker.tick();
        assert.equal(warningCount(paid.id), 1);

        // Otro pago omitido también debe avisarse aunque el primero siga pendiente.
        const secondPaid = await createOrder();
        await pool.query("UPDATE orders_payment_checkout SET state='succeeded' WHERE order_id=$1", [
          secondPaid.id,
        ]);
        await pool.query(
          "UPDATE orders_order SET expires_at=now()-interval '5 minutes' WHERE id=$1",
          [secondPaid.id],
        );
        await worker.tick();
        await worker.tick();
        assert.equal(warningCount(paid.id), 1);
        assert.equal(warningCount(secondPaid.id), 1);

        await service.recordSagaResult({
          orderId: paid.id,
          status: 'confirmed',
          rejectionReason: null,
        });
        await pool.query("UPDATE orders_order SET status='cancelled' WHERE id=$1", [secondPaid.id]);
        await worker.tick();
        // Reintroducir la inconsistencia demuestra que se retiraron ambos IDs del Set.
        await pool.query("UPDATE orders_order SET status='pending' WHERE id=ANY($1::uuid[])", [
          [paid.id, secondPaid.id],
        ]);
        await worker.tick();
        await worker.tick();
        await worker.tick();
        assert.equal(warningCount(paid.id), 2);
        assert.equal(warningCount(secondPaid.id), 2);
        for (const order of [paid, secondPaid]) {
          assert.equal((await service.getOrder(order.id)).status, 'pending');
          assert.equal(outcomes(order.id, eventSubjects.paymentFailed).length, 0);
          assert.equal(outcomes(order.id, eventSubjects.paymentSucceeded).length, 0);
        }
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
