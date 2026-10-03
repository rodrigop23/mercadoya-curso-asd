import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Hono } from 'hono';
import { paymentProvider, polarConfig } from '../dist/payment/config.js';
import {
  CheckoutRateLimited,
  CheckoutRejected,
  createPolarGateway,
  checkoutAmount,
} from '../dist/payment/polar.js';
import { createPolarWebhookRoutes, mapPolarEvent } from '../dist/payment/webhook.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;
const orderId = randomUUID();
const checkoutId = randomUUID();
const providerOrderId = randomUUID();
const timestamp = new Date().toISOString();
const paid = {
  type: 'order.paid',
  timestamp,
  data: {
    id: providerOrderId,
    checkout_id: checkoutId,
    status: 'paid',
    paid: true,
    subtotal_amount: 2400,
    currency: 'pen',
    metadata: { order_id: orderId },
  },
};
function signed(body, { id = randomUUID(), age = 0, legacy = false } = {}) {
  const seconds = String(Math.floor(Date.now() / 1000) + age);
  const key = legacy ? Buffer.from(secret) : Buffer.from(secret.slice(6), 'base64');
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': seconds,
    'webhook-signature': `v1,${createHmac('sha256', key).update(`${id}.${seconds}.${body}`).digest('base64')}`,
  };
}
function app(enqueue = async () => {}) {
  return new Hono().route('/api/payments/polar/webhook', createPolarWebhookRoutes(secret, enqueue));
}
const send = (app, body, headers = signed(body)) =>
  app.request('/api/payments/polar/webhook', { method: 'POST', body, headers });

test('Standard Webhooks y secretos Polar anteriores se verifican sobre raw body sin JWT', async () => {
  for (const legacy of [false, true]) {
    const accepted = [];
    const body = JSON.stringify(paid, null, 2);
    const headers = signed(body, { legacy });
    assert.equal(
      (
        await send(
          app(async (outcome) => {
            accepted.push(outcome);
          }),
          body,
          headers,
        )
      ).status,
      202,
    );
    assert.equal(accepted[0].eventId, headers['webhook-id']);
    assert.equal(accepted[0].orderId, orderId);
    assert.equal(accepted[0].checkoutId, checkoutId);
    assert.equal(accepted[0].providerOrderId, providerOrderId);
    assert.equal(accepted[0].outcome, 'succeeded');
  }
});

test('firma inválida, raw body alterado y timestamp viejo o futuro devuelven 403 sin encolar', async () => {
  let calls = 0;
  const route = app(async () => {
    calls++;
  });
  const body = JSON.stringify(paid);
  const headers = signed(body);
  for (const [payload, signature] of [
    [body, {}],
    [body, { ...headers, 'webhook-signature': 'v1,invalid' }],
    [`${body} `, headers],
    [body, signed(body, { age: -360 })],
    [body, signed(body, { age: 360 })],
    [body, { ...headers, 'webhook-id': randomUUID() }],
  ])
    assert.equal((await send(route, payload, signature)).status, 403);
  assert.equal(calls, 0);
});

test('firma válida con JSON, tipo o estructura inválida devuelve 400', async () => {
  for (const value of [
    '{',
    JSON.stringify({ ...paid, type: 'order.not_a_polar_event' }),
    JSON.stringify({ ...paid, data: { ...paid.data, checkout_id: 'invalid' } }),
    JSON.stringify({ ...paid, data: { ...paid.data, subtotal_amount: '2400' } }),
  ]) {
    assert.equal((await send(app(), value)).status, 400);
  }
});

test(
  'la ruta persiste antes de responder y no ejecuta efectos de saga inline',
  { timeout: 5000 },
  async () => {
    const { promise: pending, resolve: release } = Promise.withResolvers();
    const { promise: started, resolve: signalStarted } = Promise.withResolvers();
    let responded = false;
    const response = send(
      app(async () => {
        signalStarted();
        await pending;
      }),
      JSON.stringify(paid),
    ).then((result) => {
      responded = true;
      return result;
    });
    try {
      await Promise.race([
        started,
        response.then(() => assert.fail('La ruta respondió antes de persistir el evento.')),
      ]);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(responded, false);
    } finally {
      release();
    }
    assert.equal((await response).status, 202);
    assert.equal(
      (
        await send(
          app(async () => {
            throw new Error('unavailable');
          }),
          JSON.stringify(paid),
        )
      ).status,
      503,
    );
  },
);

test('checkout confirmado o exitoso no acredita cobro; failed, expired y void compensan', () => {
  for (const status of ['open', 'confirmed', 'succeeded']) {
    assert.equal(
      mapPolarEvent(
        {
          type: 'checkout.updated',
          timestamp,
          data: { id: checkoutId, status, metadata: { order_id: orderId } },
        },
        randomUUID(),
      ),
      null,
    );
  }
  for (const status of ['failed', 'expired']) {
    assert.equal(
      mapPolarEvent(
        {
          type: status === 'expired' ? 'checkout.expired' : 'checkout.updated',
          timestamp,
          data: { id: checkoutId, status, metadata: { order_id: orderId } },
        },
        randomUUID(),
      ).reason,
      `polar_checkout_${status}`,
    );
  }
  assert.equal(
    mapPolarEvent(
      { ...paid, type: 'order.updated', data: { ...paid.data, status: 'void', paid: false } },
      randomUUID(),
    ).reason,
    'polar_order_void',
  );
  assert.equal(
    mapPolarEvent(
      { ...paid, type: 'order.updated', data: { ...paid.data, status: 'pending', paid: false } },
      randomUUID(),
    ),
    null,
  );
});

test('Polar es el único proveedor y exige credenciales', () => {
  assert.equal(paymentProvider({}), 'polar');
  assert.equal(paymentProvider({ PAYMENT_PROVIDER: 'polar' }), 'polar');
  assert.throws(() => paymentProvider({ PAYMENT_PROVIDER: 'simulator' }));
  assert.throws(() => polarConfig({ PAYMENT_PROVIDER: 'simulator' }));
  assert.throws(
    () => polarConfig({ POLAR_ACCESS_TOKEN: secret }),
    (error) => !error.message.includes(secret),
  );
});

test('SDK 1.0.1 fija API 2026-04, sandbox, precio total y correlación server-side', async () => {
  const productId = randomUUID();
  const polarProductId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const gateway = createPolarGateway({
    accessToken: token,
    webhookSecret: secret,
    server: 'sandbox',
    webOrigin: 'http://localhost:5173',
  });
  const event = {
    version: 1,
    orderId,
    productId,
    quantity: 2,
    buyerId: 'buyer',
    occurredAt: timestamp,
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://sandbox-api.polar.sh/v1/checkouts/');
      assert.equal(new Headers(init.headers).get('Polar-Version'), '2026-04');
      const body = JSON.parse(init.body);
      assert.deepEqual(body.products, [polarProductId]);
      assert.deepEqual(body.metadata, { order_id: orderId, product_id: productId, quantity: 2 });
      assert.equal(body.prices[polarProductId][0].price_amount, 2400);
      assert.equal(body.prices[polarProductId][0].amount_type, 'fixed');
      assert.equal(body.prices[polarProductId][0].price_currency, 'pen');
      assert.equal(body.currency, 'pen');
      assert.equal(body.locale, 'es-PE');
      assert.equal(
        body.success_url,
        `http://localhost:5173/orders/${orderId}?checkout_id={CHECKOUT_ID}`,
      );
      assert.equal(body.external_customer_id, 'buyer');
      assert.equal(body.allow_discount_codes, false);
      return Response.json(
        {
          id: checkoutId,
          url: `https://sandbox.polar.sh/checkout/${checkoutId}`,
          expires_at: timestamp,
          amount: 2400,
          currency: 'pen',
          status: 'open',
        },
        { status: 201 },
      );
    };
    const snapshot = { productId, polarProductId, unitAmount: 1200, currency: 'pen' };
    assert.equal((await gateway.create(event, snapshot)).id, checkoutId);
    await assert.rejects(gateway.create(event, null), CheckoutRejected);
    await assert.rejects(gateway.create(event, { ...snapshot, currency: 'usd' }), CheckoutRejected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK usa un producto privado genérico y fija el importe de cada checkout sin cambiarlo', async () => {
  const items = [
    {
      productId: randomUUID(),
      polarProductId: randomUUID(),
      title: 'Palta',
      quantity: 2,
      unitAmount: 1025,
      currency: 'pen',
      thumbnailPath: 'media/palta-thumb.webp',
    },
    {
      productId: randomUUID(),
      polarProductId: randomUUID(),
      title: 'Tomate',
      quantity: 3,
      unitAmount: 700,
      currency: 'pen',
      thumbnailPath: 'media/tomate-thumb.webp',
    },
  ];
  const event = {
    version: 1,
    orderId,
    productId: items[0].productId,
    quantity: 2,
    items: items.map(({ productId, quantity }) => ({ productId, quantity })),
    buyerId: 'buyer',
    occurredAt: timestamp,
  };
  const bundleId = randomUUID();
  const gateway = createPolarGateway({
    accessToken: randomBytes(32).toString('base64url'),
    webhookSecret: secret,
    server: 'sandbox',
    webOrigin: 'http://localhost:5173',
  });
  const originalFetch = globalThis.fetch;
  let products = 0;
  let checkouts = 0;
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith('/products/')) {
        products++;
        assert.equal(body.name, 'Compra en MercadoYa');
        assert.equal(body.visibility, 'private');
        assert.equal(body.organization_id, undefined);
        assert.deepEqual(body.metadata, { mercadoya_checkout: 'purchase' });
        assert.doesNotMatch(body.description, /Palta|Tomate|41.50/);
        assert.deepEqual(body.prices, [
          {
            amount_type: 'custom',
            price_currency: 'pen',
            minimum_amount: 200,
            tax_behavior: 'exclusive',
          },
        ]);
        return Response.json({ id: bundleId }, { status: 201 });
      }
      checkouts++;
      assert.equal(init.method, 'POST');
      assert.equal(new URL(url).pathname, '/v1/checkouts/');
      assert.deepEqual(body.products, [bundleId]);
      const amount = checkouts === 1 ? 4150 : 1725;
      assert.equal(body.prices[bundleId][0].price_amount, amount);
      assert.equal(body.prices[bundleId][0].amount_type, 'fixed');
      assert.equal(body.return_url, 'http://localhost:5173/cart');
      assert.equal(
        body.success_url,
        `http://localhost:5173/orders/${orderId}?checkout_id={CHECKOUT_ID}`,
      );
      return Response.json(
        {
          id: checkoutId,
          url: 'https://sandbox.polar.sh/checkout/test',
          expires_at: timestamp,
          amount,
          currency: 'pen',
          status: 'open',
        },
        { status: 201 },
      );
    };
    assert.equal(checkoutAmount(event, items[0], items), 4150);
    assert.equal(gateway.server, 'sandbox');
    assert.equal(await gateway.createPurchaseProduct(), bundleId);
    assert.equal((await gateway.create(event, items[0], items, bundleId)).amount, 4150);
    const secondItems = items.map((item) => ({ ...item, quantity: 1 }));
    const secondEvent = { ...event, items: event.items.map((item) => ({ ...item, quantity: 1 })) };
    assert.equal((await gateway.create(secondEvent, items[0], secondItems, bundleId)).amount, 1725);
    await assert.rejects(gateway.create(event, items[0], items), CheckoutRejected);
    assert.throws(
      () => checkoutAmount(event, items[0], [{ ...items[0], quantity: 1 }, items[1]]),
      CheckoutRejected,
    );
    assert.equal(products, 1);
    assert.equal(checkouts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recupera el producto compartido por metadata y rechaza duplicados o productos inválidos', async () => {
  const gateway = createPolarGateway({
    accessToken: randomBytes(32).toString('base64url'),
    webhookSecret: secret,
    server: 'sandbox',
    webOrigin: 'http://localhost:5173',
  });
  const product = {
    id: randomUUID(),
    metadata: { mercadoya_checkout: 'purchase' },
    is_recurring: false,
    is_archived: false,
    visibility: 'private',
  };
  let items = [product];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(init.method, 'GET');
      assert.equal(new URL(url).searchParams.get('metadata[mercadoya_checkout]'), 'purchase');
      return Response.json({ items, pagination: { max_page: 1, total_count: items.length } });
    };
    assert.equal(await gateway.findPurchaseProduct(), product.id);
    for (const invalid of [
      [product, { ...product, id: randomUUID() }],
      [{ ...product, is_recurring: true }],
      [{ ...product, is_archived: true }],
      [{ ...product, visibility: 'public' }],
    ]) {
      items = invalid;
      await assert.rejects(gateway.findPurchaseProduct(), /polar_purchase_product_invalid/);
    }
    items = [{ ...product, metadata: { mercadoya_order_id: orderId } }];
    assert.equal(await gateway.findPurchaseProduct(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Kong expone solo el webhook POST sin identity-auth y no reescribe su URL', async () => {
  const config = await readFile(new URL('../../../infra/kong/kong.yml', import.meta.url), 'utf8');
  const route = config.split('- name: polar-webhook-public')[1].split('- name: orders-health')[0];
  assert.match(route, /methods: \['POST'\]/);
  assert.match(route, /strip_path: false/);
  assert.doesNotMatch(route, /identity-auth/);
  assert.match(route, /webhook\$/);
});

test('Checkout API separa rechazo, rate limit y resultado incierto sin revelar secretos', async () => {
  const productId = randomUUID();
  const gateway = createPolarGateway({
    accessToken: randomBytes(32).toString('base64url'),
    webhookSecret: secret,
    server: 'sandbox',
    webOrigin: 'http://localhost:5173',
  });
  const event = {
    version: 1,
    orderId,
    productId,
    quantity: 2,
    buyerId: 'buyer',
    occurredAt: timestamp,
  };
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, expected] of [
      [401, CheckoutRejected],
      [422, CheckoutRejected],
      [429, CheckoutRateLimited],
      [500, Error],
    ]) {
      globalThis.fetch = async () => Response.json({ detail: secret }, { status });
      await assert.rejects(
        gateway.create(event, {
          productId,
          polarProductId: randomUUID(),
          unitAmount: 1200,
          currency: 'pen',
        }),
        (error) =>
          error.constructor === expected &&
          !error.message.includes(secret) &&
          (status !== 500 || error.message === 'polar_checkout_uncertain'),
      );
      await assert.rejects(
        gateway.createPurchaseProduct(),
        (error) => error.constructor === expected && !error.message.includes(secret),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
