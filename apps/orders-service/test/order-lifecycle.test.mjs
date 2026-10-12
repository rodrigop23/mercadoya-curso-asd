import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { createOrdersRoutes } from '../dist/orders/routes.js';
import { orderLifecycleConfig } from '../dist/orders/lifecycle.js';
import { CatalogBillingError } from '../dist/catalog/http.js';

const id = '00000000-0000-4000-8000-000000000001';
const order = { id, status: 'cancelled', rejectionReason: 'order_cancelled' };
function app({
  session = { user: { id: 'buyer' } },
  cancelOrder = async () => 'cancelled',
  getSession,
} = {}) {
  return new Hono().route(
    '/api/orders',
    createOrdersRoutes(
      { getOrder: async () => order },
      { getSession: getSession ?? (async () => session) },
      { cancelOrder, getCheckout: async () => ({ provider: 'polar', checkout: null }) },
    ),
  );
}
const cancel = (route, orderId = id) =>
  route.request(`/api/orders/${orderId}/cancel`, { method: 'POST' });

test('cancelar exige sesión y UUID antes de acceder al pedido', async () => {
  let calls = 0;
  const cancelOrder = async () => {
    calls++;
    return 'cancelled';
  };
  assert.equal((await cancel(app({ session: null, cancelOrder }), 'invalid')).status, 401);
  assert.equal((await cancel(app({ cancelOrder }), 'invalid')).status, 400);
  assert.equal(calls, 0);
});

test('cancelar usa al comprador de la sesión y devuelve el estado actualizado sin cuerpo requerido', async () => {
  const calls = [];
  const route = app({
    cancelOrder: async (...args) => {
      calls.push(args);
      return 'cancelled';
    },
  });
  const response = await cancel(route);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { order });
  assert.deepEqual(calls, [[id, 'buyer']]);
});

test('cancelación repetida es 200, ajena o ausente es 404 y terminal es 409', async () => {
  for (const [result, status] of [
    ['already_cancelled', 200],
    ['not_found', 404],
    ['conflict', 409],
  ]) {
    const response = await cancel(app({ cancelOrder: async () => result }));
    assert.equal(response.status, status);
    const body = await response.json();
    if (status === 200) assert.deepEqual(body, { order });
    else assert.ok(body.error);
  }
});

test('pago en proceso se conserva como aviso 409 y caída de Polar devuelve 503', async () => {
  for (const [status, message] of [
    [409, 'El pago se está procesando'],
    [503, 'No se pudo consultar el pago.'],
  ]) {
    const response = await cancel(
      app({
        cancelOrder: async () => {
          throw new CatalogBillingError(status, message);
        },
      }),
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: message });
  }
  const response = await cancel(
    app({
      getSession: async () => {
        throw new Error('identity unavailable');
      },
    }),
  );
  assert.equal(response.status, 502);
});

test('plazos configurables validan enteros y conservan los valores por defecto', () => {
  assert.deepEqual(orderLifecycleConfig({}), { minutes: 15, graceSeconds: 120 });
  assert.deepEqual(
    orderLifecycleConfig({ ORDER_PENDING_TTL_MINUTES: '3', ORDER_EXPIRY_GRACE_SECONDS: '0' }),
    { minutes: 3, graceSeconds: 0 },
  );
  for (const value of ['0', '-1', 'bad', '1.5'])
    assert.throws(() => orderLifecycleConfig({ ORDER_PENDING_TTL_MINUTES: value }));
  for (const value of ['-1', 'bad', '1.5'])
    assert.throws(() => orderLifecycleConfig({ ORDER_EXPIRY_GRACE_SECONDS: value }));
});
