import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createTokenVerifier } from '@mercadoya/jwt-verifier';

const catalogBase = process.env.CATALOG_URL ?? 'http://localhost:3007';
const internalToken = process.env.CATALOG_INTERNAL_TOKEN;
assert.ok(internalToken, 'Smoke requiere CATALOG_INTERNAL_TOKEN.');
const base = process.env.GATEWAY_URL ?? 'http://localhost:8000';
if (!process.env.DATABASE_URL)
  throw new Error('Smoke requiere DATABASE_URL de una base de prueba.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const email = `smoke-${randomUUID()}@mercadoya.local`;
const password = randomUUID() + 'Ab1!';
const inventoryReadOrderId = randomUUID();
let cookie = '';
let userId, productId, applicationToken;
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
    '/api/catalog/health',
    '/api/media/health',
    '/api/identity/health',
    '/api/orders/health',
    '/api/inventory/health',
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
  for (const version of ['v1', 'v2']) {
    for (const suffix of ['health', 'reservations/' + randomUUID()]) {
      const path = `/api/inventory/${version}/${suffix}`;
      assert.equal((await request(path)).status, 404, path);
    }
  }
  for (const path of [
    '/api/orders',
    '/api/inventory/reservations/' + randomUUID(),
    '/api/notifications/private',
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
  for (const path of ['/api/events', '/api/events/health', '/api/events/ingest']) {
    assert.equal((await request(path)).status, 404);
    assert.equal((await request(path, { method: 'POST' })).status, 404);
  }
  const signup = await jsonPost('/api/auth/sign-up/email', { email, password, name: 'Smoke' });
  assert.equal(signup.status, 200);
  userId = (await signup.json()).user.id;
  cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.equal((await request('/api/products', { method: 'POST' })).status, 403);
  const buyerToken = (await (await request('/api/auth/token')).json()).token;
  await pool.query(
    'INSERT INTO inventory_reservations (order_id, product_id, quantity) VALUES ($1, $2, 1)',
    [inventoryReadOrderId, randomUUID()],
  );
  for (const headers of [{}, { cookie: '', authorization: `Bearer ${buyerToken}` }]) {
    const response = await request(`/api/inventory/reservations/${inventoryReadOrderId}`, {
      headers,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reservation.status, 'reserved');
    for (const header of ['deprecation', 'link', 'sunset', 'x-service-version']) {
      assert.equal(response.headers.get(header), null);
    }
  }
  assert.equal(
    (
      await request('/api/products', {
        method: 'POST',
        headers: { authorization: `Bearer ${buyerToken}` },
      })
    ).status,
    403,
  );
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
  applicationToken = token;
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
  const productData = (await product.json()).product;
  productId = productData.id;
  for (const path of [productData.imagePath, productData.imagePath.replace('-full.', '-thumb.')]) {
    const image = await request(`/uploads/${path}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.ok((await image.arrayBuffer()).byteLength > 0);
  }
  for (const origin of ['http://localhost:5173', 'http://localhost:5174']) {
    const cors = await request('/api/products', {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'Content-Type,Authorization',
      },
    });
    assert.equal(cors.status, 200);
    assert.equal(cors.headers.get('access-control-allow-origin'), origin);
    assert.equal(cors.headers.get('access-control-allow-credentials'), 'true');
  }
  const blockedOrigin = await request('/api/products', {
    method: 'POST',
    headers: { origin: 'https://untrusted.example' },
    body: form,
  });
  assert.equal(blockedOrigin.status, 403);
  const noCors = await request('/api/products', {
    headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(noCors.headers.get('access-control-allow-origin'), null);
  assert.equal(
    (await fetch(`${catalogBase}/api/products`, { method: 'POST', headers: { cookie } })).status,
    401,
  );
  assert.equal(
    (await fetch(`${catalogBase}/api/internal/catalog/products/${productId}/stock`)).status,
    401,
  );
  const stockRequest = (path, options = {}) =>
    fetch(`${catalogBase}/api/internal/catalog/products/${productId}/${path}`, {
      ...options,
      headers: { 'x-catalog-internal-token': internalToken, 'content-type': 'application/json' },
    });
  assert.deepEqual(
    await (
      await stockRequest('adjust-stock', { method: 'POST', body: JSON.stringify({ delta: -1 }) })
    ).json(),
    { adjusted: true, availableStock: 4 },
  );
  assert.deepEqual(
    await (
      await stockRequest('adjust-stock', { method: 'POST', body: JSON.stringify({ delta: 1 }) })
    ).json(),
    { adjusted: true, availableStock: 5 },
  );
  assert.deepEqual(
    await (
      await stockRequest('adjust-stock', { method: 'POST', body: JSON.stringify({ delta: -6 }) })
    ).json(),
    { adjusted: false, reason: 'insufficient_stock' },
  );
  assert.equal(
    (await stockRequest('adjust-stock', { method: 'POST', body: JSON.stringify({ delta: 0 }) }))
      .status,
    400,
  );
  assert.equal(
    (
      await request(`/api/internal/catalog/products/${productId}/stock`, {
        headers: { 'x-catalog-internal-token': internalToken },
      })
    ).status,
    404,
  );
  const update = new FormData();
  for (const [key, value] of Object.entries({
    title: 'Smoke actualizado',
    description: 'CRUD',
    price: '11',
    stock: '5',
  }))
    update.set(key, value);
  const updated = await request(`/api/products/${productId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: update,
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).product.imagePath, productData.imagePath);
  // A multipart above Kong's former 1 MiB default must still reach Media.
  const replacement = new FormData();
  for (const [key, value] of Object.entries({
    title: 'Smoke reemplazado',
    description: 'Imagen grande válida',
    price: '11',
    stock: '5',
  }))
    replacement.set(key, value);
  replacement.set(
    'image',
    new Blob([await form.get('image').arrayBuffer(), Buffer.alloc(1100000)], { type: 'image/png' }),
    'replacement.png',
  );
  const replaced = await request(`/api/products/${productId}`, {
    method: 'PUT',
    body: replacement,
  });
  assert.equal(replaced.status, 200, replaced.status === 200 ? undefined : await replaced.text());
  const oldImagePath = productData.imagePath;
  productData.imagePath = (await replaced.json()).product.imagePath;
  assert.notEqual(productData.imagePath, oldImagePath);
  assert.equal((await request(`/uploads/${oldImagePath}`)).status, 404);
  assert.equal((await request(`/uploads/${productData.imagePath}`)).status, 200);
  const tooLargeImage = new FormData();
  for (const [key, value] of Object.entries({
    title: 'Smoke',
    description: 'Imagen excedida',
    price: '11',
    stock: '5',
  }))
    tooLargeImage.set(key, value);
  tooLargeImage.set(
    'image',
    new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)], { type: 'image/png' }),
    'too-large.png',
  );
  assert.equal(
    (await request('/api/products', { method: 'POST', body: tooLargeImage })).status,
    400,
  );
  const oversized = new FormData();
  oversized.set(
    'image',
    new Blob([Buffer.alloc(3 * 1024 * 1024)], { type: 'image/png' }),
    'large.png',
  );
  assert.equal((await request('/api/products', { method: 'POST', body: oversized })).status, 413);
  const publicProducts = await fetch(`${base}/api/products`);
  assert.equal(publicProducts.status, 200);
  assert.ok((await publicProducts.json()).products.some((p) => p.id === productId));
  const created = await jsonPost('/api/orders', { productId, quantity: 1 });
  assert.equal(created.status, 409);
  assert.equal(
    (await pool.query('SELECT 1 FROM orders_order WHERE product_id=$1', [productId])).rowCount,
    0,
  );
  // Fixture de lectura; la compra exige sincronización real con Polar.
  const {
    rows: [order],
  } = await pool.query(
    "INSERT INTO orders_order(product_id, quantity, buyer_id, status) VALUES ($1, 1, $2, 'pending') RETURNING id",
    [productId, userId],
  );
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
  assert.equal(bearerOrder.status, 409);
  const checkout = await request(`/api/orders/${order.id}/checkout`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(checkout.status, 202);
  assert.deepEqual(await checkout.json(), { provider: 'polar', checkout: null });
  const stock = await fetch(`${catalogBase}/api/internal/catalog/products/${productId}/stock`, {
    headers: { 'x-catalog-internal-token': internalToken },
  });
  assert.equal((await stock.json()).availableStock, 5);
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
  const deletion = await request(`/api/products/${productId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(deletion.status, 204);
  assert.equal((await request(`/uploads/${productData.imagePath}`)).status, 404);
  productId = undefined;
  console.log(
    'Smoke OK: login/sesión, JWKS, JWT, Kong 401, health público, CRUD Catalog, uploads, CORS, límites, stock interno y rechazo de compra sin catálogo Polar listo.',
  );
} finally {
  await pool.query('DELETE FROM inventory_reservations WHERE order_id=$1', [inventoryReadOrderId]);
  // Keep order/reservation records for diagnosis, but delete the temporary identity and product.
  if (productId) {
    if (applicationToken)
      await request(`/api/products/${productId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${applicationToken}` },
      }).catch(() => undefined);
    await pool.query('DELETE FROM product WHERE id=$1', [productId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool.end();
}
