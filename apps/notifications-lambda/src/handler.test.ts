import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { handler } from './handler.js';

const payload = {
  version: 1,
  orderId: 'e9ac6bbd-a36a-4ac8-9803-04cfc6e29b81',
  productId: '4e7a4b1b-e14d-4cd1-9dc9-55e70dbd0cb0',
  quantity: 2,
  buyerId: null,
  occurredAt: '2026-09-29T12:00:00.000Z',
};
const envNames = [
  'NOTIFICATIONS_INVOKE_TOKEN',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'DEMO_NOTIFY_EMAIL',
  'EMAIL_MODE',
] as const;
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
type Call = {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
  signal?: AbortSignal | null;
};
let calls: Call[];
let resendFailure: 'api' | 'network' | undefined;
const originalInfo = console.info;
let notifications: Record<string, unknown>[];

beforeEach(() => {
  Object.assign(process.env, {
    NOTIFICATIONS_INVOKE_TOKEN: 'invoke-test',
    RESEND_API_KEY: 're_test_only',
    RESEND_FROM: 'MercadoYa <orders@example.com>',
    DEMO_NOTIFY_EMAIL: 'buyer@example.com',
    EMAIL_MODE: '',
  });
  calls = [];
  resendFailure = undefined;
  notifications = [];
  console.info = (message: string) => {
    const entry = JSON.parse(message);
    if (entry.step === 'notification.created') notifications.push(entry);
  };
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    calls.push({
      url,
      body: JSON.parse(String(options?.body)),
      headers: new Headers(options?.headers),
      signal: options?.signal,
    });
    if (url === 'https://api.resend.com/emails') {
      if (resendFailure === 'network') throw new Error('Network unavailable');
      if (resendFailure === 'api')
        return Response.json({ name: 'validation_error', message: 'Rejected' }, { status: 422 });
      return Response.json({ id: 'email-test-id' });
    }
    throw new Error(`HTTP inesperado: ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

function invoke(subject: string, extra: Record<string, unknown> = {}) {
  return handler({
    headers: { 'x-invoke-token': 'invoke-test' },
    body: JSON.stringify({ subject, payload: { ...payload, ...extra } }),
  });
}

for (const [subject, title, reason] of [
  ['payment.succeeded', 'Pedido confirmado', undefined],
  ['inventory.rejected', 'No pudimos completar tu pedido', 'insufficient_stock'],
  ['payment.failed', 'El pago no se completó', 'simulated_payment_failure'],
] as const) {
  test(`${subject} envía un correo y registra el desenlace`, async () => {
    assert.equal((await invoke(subject, reason ? { reason } : {})).statusCode, 202);
    assert.equal(calls.length, 1);
    const [send] = calls;
    assert.equal(notifications.length, 1);
    const notification = notifications[0];
    assert.equal(send.body.subject, title);
    assert.equal(send.body.to, 'buyer@example.com');
    assert.equal(send.body.from, process.env.RESEND_FROM);
    assert.match(String(send.body.html), /lang="es"/);
    assert.match(String(send.body.html), new RegExp(payload.orderId));
    assert.match(String(send.body.text), new RegExp(payload.productId));
    assert.match(String(send.body.text), /Cantidad: 2/);
    if (reason) assert.match(String(send.body.text), new RegExp(reason));
    assert.equal(send.headers.get('idempotency-key'), `${subject}/${payload.orderId}`);
    assert.ok(send.signal);
    assert.equal(notification.type, 'notification.email');
    assert.equal(notification.emailStatus, 'sent');
    assert.equal(notification.emailId, 'email-test-id');
    assert.equal(notification.body, send.body.text);
  });
}

for (const subject of ['orders.placed', 'inventory.reserved', 'inventory.released']) {
  test(`${subject} no envía correo ni genera stub`, async () => {
    assert.equal((await invoke(subject)).statusCode, 202);
    assert.equal(calls.length, 0);
  });
}

for (const scenario of ['sin key', 'modo stub', 'sin destinatario', 'destinatario vacío']) {
  test(`stub explícito ${scenario}`, async () => {
    if (scenario === 'sin key') delete process.env.RESEND_API_KEY;
    if (scenario === 'modo stub') process.env.EMAIL_MODE = 'stub';
    if (scenario === 'sin destinatario') delete process.env.DEMO_NOTIFY_EMAIL;
    if (scenario === 'destinatario vacío') process.env.DEMO_NOTIFY_EMAIL = '  ';
    assert.equal(
      (await invoke('payment.succeeded', { buyerId: 'identity-user-id' })).statusCode,
      202,
    );
    assert.equal(calls.length, 0);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'notification.stub');
    assert.equal(notifications[0].emailStatus, 'stub');
    assert.ok(notifications[0].stubReason);
    assert.notEqual(notifications[0].recipient, 'identity-user-id');
  });
}

for (const failure of ['api', 'network', 'config'] as const) {
  test(`fallo ${failure} registra el error y mantiene 202`, async () => {
    if (failure === 'config') delete process.env.RESEND_FROM;
    else resendFailure = failure;
    assert.equal((await invoke('payment.failed', { reason: 'test_failure' })).statusCode, 202);
    assert.equal(calls.length, failure === 'config' ? 0 : 1);
    assert.equal(notifications.length, 1);
    const notification = notifications[0];
    assert.equal(notification.emailStatus, 'error');
    assert.equal(notification.emailError, true);
    assert.equal(notification.type, 'notification.email');
  });
}

test('valida tokens, JSON y contratos antes de cualquier envío', async () => {
  assert.equal((await handler({ body: '{}', headers: {} })).statusCode, 401);
  assert.equal(
    (await handler({ body: '{', headers: { 'x-invoke-token': 'invoke-test' } })).statusCode,
    400,
  );
  assert.equal((await invoke('inventory.rejected', { reason: 'unknown_reason' })).statusCode, 400);
  assert.equal((await invoke('payment.failed')).statusCode, 400);
  assert.equal((await invoke('payment.succeeded', { quantity: 0 })).statusCode, 400);
  assert.equal((await invoke('unknown.subject')).statusCode, 400);
  assert.equal(calls.length, 0);
});

test('acepta body base64 de Function URL', async () => {
  const body = Buffer.from(JSON.stringify({ subject: 'payment.succeeded', payload })).toString(
    'base64',
  );
  assert.equal(
    (await handler({ body, isBase64Encoded: true, headers: { 'x-invoke-token': 'invoke-test' } }))
      .statusCode,
    202,
  );
});
