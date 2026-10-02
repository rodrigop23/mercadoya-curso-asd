import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Hono } from 'hono';
import { subscribeInventoryEvents } from '../dist/events/subscriptions.js';

process.env.DATABASE_URL = 'postgresql://unused:unused@localhost/unused';
const { createInventoryRoutes } = await import('../dist/inventory/routes.js');
const { db, closeDb } = await import('../dist/db/index.js');
after(closeDb);

const orderId = '00000000-0000-4000-8000-000000000001';
const appWithSession = (session) =>
  new Hono().route(
    '/api/inventory',
    createInventoryRoutes({
      getSession: async () => session,
    }),
  );

test('Inventory registra un handler de reserva y uno de compensación', async () => {
  const subscriptions = [];
  const onOrderPlaced = async () => {};
  const onPaymentFailed = async () => {};
  await subscribeInventoryEvents(
    { subscribe: async (...args) => subscriptions.push(args) },
    {
      onOrderPlaced,
      onPaymentFailed,
    },
  );
  assert.deepEqual(subscriptions, [
    ['orders.placed', 'inventory.reserve', onOrderPlaced],
    ['payment.failed', 'inventory.release', onPaymentFailed],
  ]);
});

test('health y reservas usan un solo contrato, sin headers de deprecación', async (t) => {
  const row = {
    id: orderId,
    orderId,
    productId: orderId,
    quantity: 1,
    createdAt: new Date('2026-09-30T00:00:00Z'),
  };
  t.mock.method(db, 'select', () => ({
    from: () => ({ where: () => ({ limit: async () => [row] }) }),
  }));
  const app = appWithSession({ user: { id: orderId } });
  const health = await app.request('/api/inventory/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { module: 'inventory', ok: true });
  const response = await app.request(`/api/inventory/reservations/${orderId}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reservation: {
      ...row,
      createdAt: row.createdAt.toISOString(),
      status: 'reserved',
    },
  });
  for (const result of [health, response]) {
    for (const header of ['deprecation', 'link', 'sunset', 'x-service-version']) {
      assert.equal(result.headers.get(header), null);
    }
  }
  for (const version of ['v1', 'v2']) {
    assert.equal((await app.request(`/api/inventory/${version}/health`)).status, 404);
    assert.equal(
      (await app.request(`/api/inventory/${version}/reservations/${orderId}`)).status,
      404,
    );
  }
});

test('las reservas exigen sesión antes de leer persistencia', async (t) => {
  const select = t.mock.method(db, 'select', () => {
    throw new Error('No debe consultar DB');
  });
  const app = appWithSession(null);
  assert.equal((await app.request('/api/inventory/reservations/invalid')).status, 401);
  assert.equal((await app.request('/api/inventory/health')).status, 200);
  assert.equal(select.mock.callCount(), 0);
});

test('las reservas validan UUID y distinguen reserva ausente', async (t) => {
  const select = t.mock.method(db, 'select', () => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }));
  const app = appWithSession({ user: { id: orderId } });
  assert.equal((await app.request('/api/inventory/reservations/invalid')).status, 400);
  assert.equal(select.mock.callCount(), 0);
  assert.equal((await app.request(`/api/inventory/reservations/${orderId}`)).status, 404);
});
