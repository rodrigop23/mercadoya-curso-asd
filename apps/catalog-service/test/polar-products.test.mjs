import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  createProductGateway,
  ProductSyncRejected,
  ProductSyncRetryable,
  ProductSyncUncertain,
} from '../dist/modules/catalog/polar-gateway.js';
import { catalogPolarConfig } from '../dist/modules/catalog/polar-config.js';

const desired = {
  title: 'Producto',
  description: 'Descripción',
  unitAmount: 1234,
  currency: 'pen',
  archived: false,
};
const config = () => ({ accessToken: randomBytes(32).toString('base64url'), server: 'sandbox' });

test('SDK prepara PEN y crea compra única con correlación, precio y API 2026-04', async () => {
  const original = globalThis.fetch;
  const organizationId = randomUUID();
  const productId = randomUUID();
  const remoteId = randomUUID();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init.headers).get('Polar-Version'), '2026-04');
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push([init.method, path, body]);
    if (path === '/v1/organizations/')
      return Response.json({
        items: [{ id: organizationId, default_presentment_currency: 'usd' }],
        pagination: { total_count: 1 },
      });
    if (path === `/v1/organizations/${organizationId}`) {
      assert.deepEqual(body, { default_presentment_currency: 'pen' });
      return Response.json({ id: organizationId, default_presentment_currency: 'pen' });
    }
    assert.equal(url, 'https://sandbox-api.polar.sh/v1/products/');
    // Polar devuelve 422 organization_token si un OAT envía este campo.
    assert.equal(Object.hasOwn(body, 'organization_id'), false);
    assert.equal(body.recurring_interval, null);
    assert.deepEqual(body.metadata, { mercadoya_product_id: productId });
    assert.deepEqual(body.prices, [
      {
        amount_type: 'fixed',
        price_currency: 'pen',
        price_amount: 1234,
        tax_behavior: 'exclusive',
      },
    ]);
    assert.equal(Array.from(body.name).length, 64);
    return Response.json({ id: remoteId }, { status: 201 });
  };
  try {
    const gateway = createProductGateway(config());
    await gateway.prepare();
    await gateway.prepare();
    assert.equal(await gateway.create(productId, { ...desired, title: 'á'.repeat(160) }), remoteId);
    assert.deepEqual(
      calls.map(([method]) => method),
      ['GET', 'PATCH', 'POST'],
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('cambiar precio reemplaza la lista; editar texto conserva el precio y DELETE archiva', async () => {
  const original = globalThis.fetch;
  const id = randomUUID();
  let amount = 1234;
  let updates = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).pathname, `/v1/products/${id}`);
    if (init.method === 'GET')
      return Response.json({
        prices: [
          {
            id: randomUUID(),
            is_archived: false,
            amount_type: 'fixed',
            price_currency: 'pen',
            price_amount: amount,
            tax_behavior: 'exclusive',
          },
        ],
      });
    const body = JSON.parse(init.body);
    updates++;
    if (updates === 1) assert.equal(body.prices, undefined);
    if (updates === 2) {
      assert.equal(body.prices[0].price_amount, 5678);
      amount = 5678;
    }
    if (updates === 3) assert.equal(body.prices, undefined); // respuesta perdida tras aplicar el cambio
    if (updates === 4) assert.deepEqual(body, { is_archived: true });
    return Response.json({ id });
  };
  try {
    const gateway = createProductGateway(config());
    await gateway.update(id, desired);
    await gateway.update(id, { ...desired, unitAmount: 5678 });
    await gateway.update(id, { ...desired, unitAmount: 5678 });
    await gateway.update(id, { ...desired, archived: true });
  } finally {
    globalThis.fetch = original;
  }
});

test('límites PEN, rechazo y creación incierta no exponen secretos', async () => {
  const original = globalThis.fetch;
  const secret = randomBytes(32).toString('base64url');
  const gateway = createProductGateway({ accessToken: secret, server: 'sandbox' });
  try {
    for (const unitAmount of [1, 199, 100_000_000, 2.5])
      await assert.rejects(
        gateway.create(randomUUID(), { ...desired, unitAmount }),
        /polar_amount_invalid/,
      );
    for (const [status, expected] of [
      [401, ProductSyncRejected],
      [403, ProductSyncRejected],
      [422, ProductSyncRejected],
      [429, ProductSyncRetryable],
      [408, ProductSyncUncertain],
      [500, ProductSyncUncertain],
    ]) {
      globalThis.fetch = async () => Response.json({ detail: secret }, { status });
      await assert.rejects(
        gateway.create(randomUUID(), desired),
        (error) =>
          error instanceof expected &&
          error.operation === 'products.create' &&
          error.httpStatus === status &&
          !JSON.stringify(error).includes(secret) &&
          !error.message.includes(secret),
      );
    }
    assert.equal(catalogPolarConfig({ PAYMENT_PROVIDER: 'simulator' }), null);
    assert.throws(() => catalogPolarConfig({}), /POLAR_ACCESS_TOKEN/);
  } finally {
    globalThis.fetch = original;
  }
});

test('errores conservan la operación y 429 conserva Retry-After sin payloads ni credenciales', async () => {
  const original = globalThis.fetch;
  const secret = randomBytes(32).toString('base64url');
  try {
    globalThis.fetch = async () => Response.json({ detail: secret }, { status: 403 });
    await assert.rejects(createProductGateway(config()).prepare(), (error) => {
      assert.equal(error.message, 'polar_permission_denied');
      assert.equal(error.operation, 'organizations.list');
      assert.equal(error.httpStatus, 403);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    });
    globalThis.fetch = async () =>
      Response.json({ detail: secret }, { status: 429, headers: { 'Retry-After': '120' } });
    await assert.rejects(createProductGateway(config()).create(randomUUID(), desired), (error) => {
      assert.ok(error instanceof ProductSyncRetryable);
      assert.equal(error instanceof ProductSyncUncertain, false);
      assert.equal(error.retryAfter, 120);
      assert.equal(error.httpStatus, 429);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('recuperación filtra metadata exacta y rechaza coincidencias duplicadas o suscripciones', async () => {
  const original = globalThis.fetch;
  const productId = randomUUID();
  const remoteId = randomUUID();
  let items = [
    { id: remoteId, metadata: { mercadoya_product_id: productId }, is_recurring: false },
  ];
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).searchParams.get('metadata[mercadoya_product_id]'), productId);
    return Response.json({ items, pagination: { max_page: 1, total_count: items.length } });
  };
  try {
    const gateway = createProductGateway(config());
    assert.equal(await gateway.find(productId), remoteId);
    items = [items[0], { ...items[0], id: randomUUID() }];
    await assert.rejects(gateway.find(productId), /polar_product_duplicate/);
    items = [{ ...items[0], is_recurring: true }];
    await assert.rejects(gateway.find(productId), /polar_product_not_one_time/);
    items = [{ ...items[0], metadata: { mercadoya_product_id: randomUUID() } }];
    assert.equal(await gateway.find(productId), null);
  } finally {
    globalThis.fetch = original;
  }
});
