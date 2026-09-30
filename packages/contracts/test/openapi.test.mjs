import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedDocuments } from '../scripts/openapi.mjs';

const inventory = generatedDocuments.get('apps/inventory-service/openapi.yaml');
const orders = generatedDocuments.get('apps/orders-service/openapi.yaml');
const identity = generatedDocuments.get('apps/identity-service/openapi.yaml');
const catalog = generatedDocuments.get('apps/catalog-service/openapi/catalog.yaml');

test('Inventory anuncia el despliegue correcto para cada versión y usa el alias v2', () => {
  for (const prefix of ['/api/inventory', '/api/inventory/v1', '/api/inventory/v2']) {
    const path = inventory.paths[`${prefix}/reservations/{orderId}`];
    const v2 = !prefix.endsWith('v1');
    assert.deepEqual(
      path.servers.map((server) => server.url),
      ['http://localhost:8000', v2 ? 'http://localhost:3005' : 'http://localhost:3003'],
    );
    assert.equal(path.get.deprecated, v2 ? undefined : true);
    assert.equal(
      path.get.responses[200].content['application/json'].schema.$ref,
      `#/components/schemas/ReservationResponseV${v2 ? 2 : 1}`,
    );
    assert.deepEqual(Object.keys(path).sort(), ['get', 'servers']);
    const health = inventory.paths[`${prefix}/health`];
    assert.equal(health.get.deprecated, v2 ? undefined : true);
    if (!v2) {
      assert.match(path.get.description, /Migra a \/api\/inventory\/v2/);
      for (const operation of [path.get, health.get]) {
        for (const response of Object.values(operation.responses)) {
          assert.equal(response.headers.Deprecation.schema.const, '@1790726400');
          assert.match(response.headers.Link.description, /successor-version/);
          assert.equal(response.headers.Sunset, undefined);
        }
      }
    }
  }
});

test('los bordes documentados distinguen sesión browser, JWT y token interno de stock', () => {
  assert.deepEqual(orders.paths['/api/orders/{orderId}'].get.security, [
    { betterAuthSession: [] },
    { applicationJWT: [] },
  ]);
  assert.deepEqual(orders.paths['/api/orders'].post.security, [
    { betterAuthSession: [] },
    { applicationJWT: [] },
  ]);
  assert.deepEqual(identity.paths['/api/me'].get.security, [{ betterAuthSession: [] }]);
  assert.deepEqual(catalog.paths['/api/internal/catalog/products/{id}/stock'].get.security, [
    { catalogInternalToken: [] },
  ]);
  for (const doc of generatedDocuments.values()) {
    assert.equal(doc.components.securitySchemes.betterAuthSession.in, 'cookie');
    assert.equal(doc.components.securitySchemes.applicationJWT.bearerFormat, 'JWT');
  }
  assert.equal(
    catalog.paths['/api/products'].post.requestBody.content['multipart/form-data'].schema.$ref,
    '#/components/schemas/CreateProduct',
  );
  assert.equal(catalog.components.schemas.CreateProduct.required.includes('image'), true);
  assert.equal(catalog.components.schemas.UpdateProduct.required.includes('image'), false);
});

test('Catalog documenta origen interno y límites reales de Kong y Hono', () => {
  for (const suffix of ['stock', 'adjust-stock']) {
    assert.deepEqual(
      catalog.paths[`/api/internal/catalog/products/{id}/${suffix}`].servers.map(
        (server) => server.url,
      ),
      ['http://localhost:3007'],
    );
  }
  for (const operation of [
    catalog.paths['/api/products'].post,
    catalog.paths['/api/products/{id}'].put,
  ]) {
    assert.ok(operation.responses[413].content['application/json']);
    assert.ok(operation.responses[413].content['text/html']);
  }
});
