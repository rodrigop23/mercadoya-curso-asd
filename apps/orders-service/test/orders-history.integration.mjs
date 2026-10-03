import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Pool } from 'pg';
import { Hono } from 'hono';
import { ordersResponseSchema } from '@mercadoya/contracts';

assert.ok(process.env.ORDERS_TEST_DATABASE_URL, 'Configura ORDERS_TEST_DATABASE_URL dedicado.');
const base = new Pool({ connectionString: process.env.ORDERS_TEST_DATABASE_URL });
const schema = `history_test_${randomBytes(8).toString('hex')}`;
await base.query(`CREATE SCHEMA ${schema}`);
const databaseUrl = new URL(process.env.ORDERS_TEST_DATABASE_URL);
databaseUrl.searchParams.set('options', `-csearch_path=${schema}`);
process.env.DATABASE_URL = databaseUrl.href;
const { pool, closeDb } = await import('../dist/db/index.js');
const { createOrdersService } = await import('../dist/orders/service.js');
const { createOrdersRoutes } = await import('../dist/orders/routes.js');

test('PostgreSQL filtra comprador, ordena todo el historial y conserva la consulta de estado', async () => {
  try {
    const baseline = await readFile(
      new URL('../../catalog-service/drizzle/0000_lumpy_lockheed.sql', import.meta.url),
      'utf8',
    );
    await pool.query(baseline.match(/CREATE TABLE "orders_order" \([\s\S]*?\n\);/)[0]);
    for (const file of ['0001_payments.sql', '0002_pricing.sql', '0003_cart.sql']) {
      await pool.query(await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    }
    const productId = randomUUID();
    const polarProductId = randomUUID();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const product = { productId, polarProductId, unitAmount: 1200, currency: 'pen' };
    const items = [{ ...product, title: 'Palta del pedido', thumbnailPath: null, quantity: 2 }];
    const fixtures = [
      ['buyer-a', 'pending', '2026-10-01T12:00:00Z'],
      ['buyer-a', 'confirmed', '2026-10-03T12:00:00Z'],
      ['buyer-b', 'confirmed', '2026-10-04T12:00:00Z'],
      [null, 'confirmed', '2026-10-05T12:00:00Z'],
      ['buyer-a', 'rejected', '2026-10-03T12:00:00Z'],
    ];
    for (const [index, [buyerId, status, createdAt]] of fixtures.entries()) {
      await pool.query(
        `INSERT INTO orders_order (id, product_id, quantity, buyer_id, status, created_at, payment_product, items)
         VALUES ($1, $2, 2, $3, $4, $5, $6, $7)`,
        [
          ids[index],
          productId,
          buyerId,
          status,
          createdAt,
          JSON.stringify(product),
          index === 0 ? null : JSON.stringify(items),
        ],
      );
    }
    const service = createOrdersService(
      { publish: async () => assert.fail('El historial no debe publicar eventos.') },
      { getBillingProduct: async () => assert.fail('El historial no debe consultar Catalog.') },
    );
    const route = new Hono().route(
      '/api/orders',
      createOrdersRoutes(
        service,
        { getSession: async () => ({ user: { id: 'buyer-a' } }) },
        { getCheckout: async () => ({ provider: 'polar', checkout: null }) },
      ),
    );
    const response = await route.request('/api/orders?buyerId=buyer-b');
    assert.equal(response.status, 200);
    const payload = await response.json();
    for (const order of payload.orders) {
      assert.equal(order.paymentProduct, undefined);
      assert.equal(order.items?.[0].polarProductId, undefined);
    }
    const { orders } = ordersResponseSchema.parse(payload);
    assert.deepEqual(
      orders.map((order) => order.id),
      [...[ids[1], ids[4]].sort().reverse(), ids[0]],
    );
    assert.deepEqual(
      new Set(orders.map((order) => order.status)),
      new Set(['pending', 'confirmed', 'rejected']),
    );
    for (const order of orders) {
      assert.equal(order.buyerId, 'buyer-a');
      assert.equal(order.totalAmount, 2400);
      assert.equal((await route.request(`/api/orders/${order.id}`)).status, 200);
    }
    assert.equal((await route.request(`/api/orders/${ids[2]}`)).status, 404);
    assert.equal((await route.request(`/api/orders/${ids[2]}/checkout`)).status, 404);
    assert.deepEqual(await service.listOrders('buyer-without-orders'), []);
  } finally {
    await closeDb();
    await base.query(`DROP SCHEMA ${schema} CASCADE`);
    await base.end();
  }
});
