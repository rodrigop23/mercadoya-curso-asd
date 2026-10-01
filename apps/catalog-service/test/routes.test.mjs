import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productsResponseSchema, stockAdjustmentResponseSchema } from '@mercadoya/contracts';

const uploads = await mkdtemp(join(tmpdir(), 'catalog-media-'));
process.env.UPLOADS_DIR = uploads;
process.env.CATALOG_INTERNAL_TOKEN = 'catalog-test-token';
const { createCatalogRoutes } = await import('../dist/modules/catalog/routes.js');
const { createMediaModule } = await import('../dist/modules/media/index.js');
after(() => rm(uploads, { recursive: true, force: true }));
const id = '00000000-0000-4000-8000-000000000001';
const product = {
  id,
  title: 'Producto',
  description: 'Prueba',
  price: 10,
  stock: 5,
  imagePath: 'media/test.png',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const image = () =>
  new File(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8AARGDiPwMAHfAD/aAzCYkAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
    'test.png',
    { type: 'image/png' },
  );
function form(withImage = true) {
  const body = new FormData();
  for (const [key, value] of Object.entries({
    title: 'Producto',
    description: 'Prueba',
    price: '10',
    stock: '5',
  }))
    body.set(key, value);
  if (withImage) body.set('image', image());
  return body;
}
function app(authorization = { allowed: true }, overrides = {}) {
  return createCatalogRoutes(
    { requireAdmin: async () => authorization },
    {
      listProducts: async () => [product],
      createProduct: async () => product,
      updateProduct: async () => product,
      deleteProduct: async () => true,
      getBillingProduct: async () => ({ status: 'pending', product: null }),
      getAvailableStock: async () => 5,
      adjustStock: async () => ({ adjusted: true, availableStock: 4 }),
      ...overrides,
    },
  );
}
test('lectura buyer y CRUD conservan contratos y códigos HTTP', async () => {
  const routes = app();
  productsResponseSchema.parse(await (await routes.request('/api/products')).json());
  assert.equal(
    (await routes.request('/api/products', { method: 'POST', body: form() })).status,
    201,
  );
  assert.equal(
    (await routes.request(`/api/products/${id}`, { method: 'PUT', body: form(false) })).status,
    200,
  );
  assert.equal((await routes.request(`/api/products/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal(
    (await routes.request('/api/products', { method: 'POST', body: form(false) })).status,
    400,
  );
  assert.equal(
    (
      await app({ allowed: true }, { updateProduct: async () => null }).request(
        `/api/products/${id}`,
        { method: 'PUT', body: form(false) },
      )
    ).status,
    404,
  );
});
test('no autenticado 401 y buyer 403 antes de ejecutar el CRUD', async () => {
  for (const status of [401, 403]) {
    const routes = app(
      { allowed: false, status },
      {
        createProduct: () => {
          throw new Error('No autorizado');
        },
      },
    );
    for (const [method, path] of [
      ['POST', '/api/products'],
      ['PUT', `/api/products/${id}`],
      ['DELETE', `/api/products/${id}`],
    ]) {
      assert.equal((await routes.request(path, { method })).status, status);
    }
  }
});
test('stock mantiene token S2S independiente, validación y DTO', async () => {
  const routes = app();
  const path = `/api/internal/catalog/products/${id}/adjust-stock`;
  const headers = {
    'x-catalog-internal-token': 'catalog-test-token',
    'content-type': 'application/json',
  };
  assert.equal(
    (await routes.request(path, { method: 'POST', headers: { authorization: 'Bearer token' } }))
      .status,
    401,
  );
  const valid = await routes.request(path, {
    method: 'POST',
    headers,
    body: JSON.stringify({ delta: -1 }),
  });
  stockAdjustmentResponseSchema.parse(await valid.json());
  for (const delta of [0, 1.5, '1'])
    assert.equal(
      (await routes.request(path, { method: 'POST', headers, body: JSON.stringify({ delta }) }))
        .status,
      400,
    );
  assert.equal(
    (await routes.request('/api/internal/catalog/products/invalid/stock', { headers })).status,
    400,
  );
});

test('billing es interno, sin caché y distingue sincronización pendiente, fallida y lista', async () => {
  const path = `/api/internal/catalog/products/${id}/billing`;
  const headers = { 'x-catalog-internal-token': 'catalog-test-token' };
  assert.equal((await app().request(path)).status, 401);
  for (const [status, expected] of [
    ['pending', 202],
    ['failed', 409],
    ['ready', 200],
  ]) {
    const result = {
      status,
      product:
        status === 'ready'
          ? { productId: id, polarProductId: id, unitAmount: 1000, currency: 'pen' }
          : null,
    };
    const response = await app(
      { allowed: true },
      { getBillingProduct: async () => result },
    ).request(path, { headers });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), result);
  }
  assert.equal(
    (
      await app({ allowed: true }, { getBillingProduct: async () => null }).request(path, {
        headers,
      })
    ).status,
    404,
  );
});
test('Media genera full/thumb en el volumen configurado y Catalog las sirve sin S3', async () => {
  const media = createMediaModule();
  const asset = await media.contract.processProductImage(image());
  const routes = app();
  for (const path of [asset.imagePath, asset.thumbPath]) {
    const response = await routes.request(`/uploads/${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  await media.contract.deleteProductImage(asset);
  assert.equal((await routes.request(asset.imageUrl)).status, 404);
  await assert.rejects(
    () => media.contract.processProductImage(new File(['fake'], 'fake.png', { type: 'image/png' })),
    /contenido/,
  );
});

test('el proceso directo limita multipart completo y cuerpos sin Content-Length', async () => {
  process.env.DATABASE_URL = 'postgresql://unused:unused@localhost/unused';
  const { createApp } = await import('../dist/app.js');
  const { closeDb } = await import('../dist/db/index.js');
  try {
    const routes = createApp();
    for (const path of ['/api/products', `/api/products/${id}`]) {
      const response = await routes.request(path, {
        method: path.endsWith(id) ? 'PUT' : 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=test' },
        body: Buffer.alloc(3 * 1024 * 1024 + 1),
      });
      assert.equal(response.status, 413);
      assert.match((await response.json()).error, /3 MB/);
    }
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const streamed = await routes.request('/api/products', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    });
    assert.equal(streamed.status, 413);
  } finally {
    await closeDb();
  }
});
