import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Hono } from 'hono';
import { subscribeInventoryEvents } from '../dist/events/subscriptions.js';

process.env.DATABASE_URL = 'postgresql://unused:unused@localhost/unused';
const { createInventoryRoutes } = await import('../dist/inventory/routes.js');
const { db, closeDb } = await import('../dist/db/index.js');
after(closeDb);

test('solo v2 registra reserva y compensación con ambos despliegues', async () => {
  const subscriptions = [];
  const onOrderPlaced = async () => {};
  const onPaymentFailed = async () => {};
  const bus = { subscribe: async (...args) => subscriptions.push(args) };
  await subscribeInventoryEvents(bus, { onOrderPlaced, onPaymentFailed }, 'v1');
  assert.equal(subscriptions.length, 0);
  await subscribeInventoryEvents(bus, { onOrderPlaced, onPaymentFailed }, 'v2');
  assert.deepEqual(subscriptions, [
    ['orders.placed', 'inventory.reserve', onOrderPlaced],
    ['payment.failed', 'inventory.release', onPaymentFailed],
  ]);
});

test('health, deprecación y lectura v2 mantienen las rutas reales y los DTO', async (t) => {
  const orderId = '00000000-0000-4000-8000-000000000001';
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
  for (const version of ['v1', 'v2']) {
    const app = new Hono().route(
      '/api/inventory',
      createInventoryRoutes(
        {
          getSession: async () => ({ user: { id: orderId } }),
        },
        version,
      ),
    );
    const health = await app.request(`/api/inventory/${version}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).serviceVersion, version);
    const response = await app.request(`/api/inventory/${version}/reservations/${orderId}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-service-version'), version);
    const { reservation } = await response.json();
    assert.equal(reservation.status, version === 'v2' ? 'reserved' : undefined);
    if (version === 'v1') {
      for (const result of [health, response]) {
        assert.equal(result.headers.get('deprecation'), '@1790726400');
        assert.match(result.headers.get('link'), /\/api\/inventory\/v2\/.*rel="successor-version"/);
        assert.equal(result.headers.get('sunset'), null);
      }
      assert.equal((await app.request('/api/inventory/health')).status, 404);
      assert.equal((await app.request(`/api/inventory/reservations/${orderId}`)).status, 404);
    } else {
      assert.equal(response.headers.get('deprecation'), null);
      assert.equal((await app.request('/api/inventory/health')).status, 200);
      const alias = await app.request(`/api/inventory/reservations/${orderId}`);
      assert.equal((await alias.json()).reservation.status, 'reserved');
    }
  }
});

test('la lectura v2 y su alias exigen sesión antes de leer persistencia', async (t) => {
  const select = t.mock.method(db, 'select', () => {
    throw new Error('No debe consultar DB');
  });
  const app = new Hono().route(
    '/api/inventory',
    createInventoryRoutes(
      {
        getSession: async () => null,
      },
      'v2',
    ),
  );
  for (const prefix of ['/api/inventory', '/api/inventory/v2']) {
    assert.equal((await app.request(`${prefix}/reservations/invalid`)).status, 401);
  }
  assert.equal(select.mock.callCount(), 0);
});
