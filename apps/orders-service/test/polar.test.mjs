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
} from '../dist/payment/polar.js';
import { createPolarWebhookRoutes, mapPolarEvent } from '../dist/payment/webhook.js';
import { subscribePaymentSimulator } from '../dist/payment/simulator.js';

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

test('la ruta persiste antes de responder y no ejecuta efectos de saga inline', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let started = false;
  const response = send(
    app(async () => {
      started = true;
      await pending;
    }),
    JSON.stringify(paid),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started, true);
  release();
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
});

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

test('Polar es default; el override didáctico no puede activar el simulador', async () => {
  assert.equal(paymentProvider({}), 'polar');
  assert.equal(paymentProvider({ PAYMENT_PROVIDER: 'simulator' }), 'simulator');
  assert.throws(() => paymentProvider({ PAYMENT_PROVIDER: 'stripe' }));
  const original = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = 'polar';
  try {
    await assert.rejects(subscribePaymentSimulator({}), /requiere PAYMENT_PROVIDER=simulator/);
  } finally {
    if (original === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = original;
  }
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
    paymentMode: 'succeed',
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
        (error) => error instanceof expected && !error.message.includes(secret),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
