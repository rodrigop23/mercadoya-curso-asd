import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { createOrdersRoutes } from '../dist/orders/routes.js';

function app({
  session = { user: { id: 'buyer-a' } },
  listOrders = async () => [],
  getSession,
} = {}) {
  return new Hono().route(
    '/api/orders',
    createOrdersRoutes(
      { listOrders },
      { getSession: getSession ?? (async () => session) },
      { getCheckout: async () => ({ provider: 'polar', checkout: null }) },
    ),
  );
}

test('historial requiere sesión y no consulta Orders para un visitante', async () => {
  let reads = 0;
  const route = app({
    session: null,
    listOrders: async () => {
      reads++;
      return [];
    },
  });
  const response = await route.request('/api/orders');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(reads, 0);
});

test('el comprador del historial procede de la sesión, incluso con buyerId ajeno en la URL', async () => {
  const calls = [];
  const orders = [{ id: 'fixture-order', buyerId: 'buyer-a' }];
  const route = app({
    listOrders: async (buyerId) => {
      calls.push(buyerId);
      return orders;
    },
  });
  for (const path of ['/api/orders?buyerId=buyer-b', '/api/orders']) {
    const response = await route.request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { orders });
  }
  assert.deepEqual(calls, ['buyer-a', 'buyer-a']);
});

test('el historial vacío devuelve una lista y los fallos devuelven errores recuperables', async () => {
  const empty = await app().request('/api/orders');
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { orders: [] });
  const failed = await app({
    listOrders: async () => {
      throw new Error('database unavailable');
    },
  }).request('/api/orders');
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'No se pudieron consultar tus pedidos.' });
  const identityFailed = await app({
    getSession: async () => {
      throw new Error('identity unavailable');
    },
  }).request('/api/orders');
  assert.equal(identityFailed.status, 502);
  assert.deepEqual(await identityFailed.json(), { error: 'No se pudo validar la sesión.' });
});
