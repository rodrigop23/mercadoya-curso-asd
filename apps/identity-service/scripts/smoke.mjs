import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createTokenVerifier } from '@mercadoya/jwt-verifier';

const base = process.env.GATEWAY_URL ?? 'http://localhost:8000';
if (!process.env.DATABASE_URL)
  throw new Error('Smoke requiere DATABASE_URL de una base de prueba.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const email = `smoke-${randomUUID()}@mercadoya.local`;
const password = randomUUID() + 'Ab1!';
let cookie = '';
let userId, productId;
const request = (path, options = {}) =>
  fetch(`${base}${path}`, {
    ...options,
    headers: { origin: 'http://localhost:5173', cookie, ...options.headers },
    signal: AbortSignal.timeout(10000),
  });
const jsonPost = (path, body, headers = {}) =>
  request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
try {
  for (const path of [
    '/api/identity/health',
    '/api/orders/health',
    '/api/inventory/health',
    '/api/inventory/v1/health',
    '/api/inventory/v2/health',
    '/api/notifications/health',
  ]) {
    let status;
    for (let attempt = 0; attempt < 60; attempt++) {
      status = await request(path)
        .then((response) => response.status)
        .catch(() => 0);
      if (status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(status, 200, path);
  }
  for (const path of [
    '/api/orders',
    '/api/inventory/reservations/' + randomUUID(),
    '/api/notifications/private',
    '/api/events',
  ]) {
    const method = path === '/api/orders' ? 'POST' : 'GET';
    assert.equal(
      (await request(path, { method, headers: { authorization: 'Bearer invalid' } })).status,
      401,
      path,
    );
  }
  const preflight = await request('/api/orders', {
    method: 'OPTIONS',
    headers: {
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Content-Type',
    },
  });
  assert.equal(preflight.status, 200);
  assert.equal((await request('/api/identity/verify', { method: 'POST' })).status, 404);
  assert.equal(
    (await request('/api/internal/catalog/products/' + randomUUID() + '/stock')).status,
    404,
  );
  assert.equal((await request('/api/events/ingest', { method: 'POST' })).status, 404);
  const signup = await jsonPost('/api/auth/sign-up/email', { email, password, name: 'Smoke' });
  assert.equal(signup.status, 200);
  userId = (await signup.json()).user.id;
  await pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ['admin', userId]);
  const login = await jsonPost('/api/auth/sign-in/email', { email, password });
  assert.equal(login.status, 200);
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.ok(cookie.includes('session_token='));
  // Reapplying Identity migrations must preserve the active browser session.
  await pool.query(
    await readFile(new URL('../migrations/0001_identity.sql', import.meta.url), 'utf8'),
  );
  const me = await request('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(me.headers.get('access-control-allow-credentials'), 'true');
  assert.equal((await me.json()).user.id, userId);
  const jwks = await (await request('/api/auth/jwks')).json();
  assert.ok(jwks.keys.length);
  for (const key of jwks.keys) {
    assert.ok(key.kid);
    assert.equal(key.d, undefined);
  }
  assert.equal((await request('/api/auth/get-session')).headers.has('set-auth-jwt'), false);
  const tokenResponse = await request('/api/auth/token');
  assert.equal(tokenResponse.status, 200);
  const { token } = await tokenResponse.json();
  const verify = createTokenVerifier({ jwksURL: `${base}/api/auth/jwks` });
  assert.deepEqual(await verify(`Bearer ${token}`), { sub: userId, role: 'admin' });
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title: 'Smoke',
    description: 'Gateway smoke',
    price: '10',
    stock: '5',
  }))
    form.set(key, value);
  form.set(
    'image',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AARGDiPwMAHfAD/aAzCYkAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      { type: 'image/png' },
    ),
    'smoke.png',
  );
  const product = await request('/api/products', { method: 'POST', body: form });
  assert.equal(product.status, 201, product.status === 201 ? undefined : await product.text());
  productId = (await product.json()).product.id;
  const created = await jsonPost('/api/orders', { productId, quantity: 1 });
  assert.equal(created.status, 202);
  const { order } = await created.json();
  assert.equal(order.buyerId, userId);
  const browserCookie = cookie;
  assert.equal(
    (await jsonPost('/api/orders', { productId, quantity: 1 }, { authorization: 'Bearer invalid' }))
      .status,
    401,
  );
  assert.equal(
    (
      await request('/api/orders', {
        method: 'POST',
        headers: { origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  );
  cookie = '';
  const bearerOrder = await jsonPost(
    '/api/orders',
    { productId, quantity: 1 },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(bearerOrder.status, 202);
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await request(`/api/orders/${order.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(result.status, 200);
    if ((await result.json()).order.status === 'confirmed') break;
    if (attempt === 39) throw new Error('La saga no confirmó el pedido.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const reservation = await request(`/api/inventory/reservations/${order.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(reservation.status, 200);
  assert.equal(reservation.headers.get('x-service-version'), 'v2');
  assert.equal((await reservation.json()).reservation.status, 'reserved');
  for (let attempt = 0; attempt < 40; attempt++) {
    const timeline = await request(`/api/events?orderId=${order.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(timeline.status, 200);
    const { events } = await timeline.json();
    if (events.some((event) => event.type === 'notification.stub' && event.orderId === order.id))
      break;
    if (attempt === 39) throw new Error('Notifications no registró el stub mediante su token S2S.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(
    (
      await request('/api/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}broken` },
      })
    ).status,
    401,
  );
  assert.equal((await request('/api/me')).status, 401);
  cookie = browserCookie;
  assert.equal((await jsonPost('/api/auth/sign-out', {})).status, 200);
  assert.equal((await request('/api/me')).status, 401);
  assert.equal((await jsonPost('/api/orders', { productId, quantity: 1 })).status, 401);
  // The issued JWT has its own five-minute lifetime after session logout.
  assert.equal(
    (await request(`/api/orders/${order.id}`, { headers: { authorization: `Bearer ${token}` } }))
      .status,
    200,
  );
  console.log(
    'Smoke OK: login/sesión, JWKS, JWT, Kong 401, health público, pedido browser/Bearer y saga Inventory v2.',
  );
} finally {
  // Keep order/reservation records for diagnosis, but delete the temporary identity and product.
  if (productId) await pool.query('DELETE FROM product WHERE id=$1', [productId]);
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool.end();
}
