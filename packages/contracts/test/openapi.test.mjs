import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedDocuments } from '../scripts/openapi.mjs';

const inventory = generatedDocuments.get('apps/inventory-service/openapi.yaml');
const orders = generatedDocuments.get('apps/orders-service/openapi.yaml');
const identity = generatedDocuments.get('apps/api/openapi/identity.yaml');
const catalog = generatedDocuments.get('apps/api/openapi/catalog.yaml');

test('Inventory anuncia el despliegue correcto para cada versión y mantiene el alias v1', () => {
  for (const prefix of ['/api/inventory', '/api/inventory/v1', '/api/inventory/v2']) {
    const path = inventory.paths[`${prefix}/reservations/{orderId}`];
    const v2 = prefix.endsWith('v2');
    assert.deepEqual(
      path.servers.map((server) => server.url),
      ['http://localhost:3001', v2 ? 'http://localhost:3005' : 'http://localhost:3003'],
    );
    assert.equal(path.get.deprecated, v2 ? undefined : true);
    assert.equal(
      path.get.responses[200].content['application/json'].schema.$ref,
      `#/components/schemas/ReservationResponseV${v2 ? 2 : 1}`,
    );
    assert.deepEqual(Object.keys(path).sort(), ['get', 'servers']);
  }
});

test('los bordes documentados conservan cookie, GET público y token interno de stock', () => {
  assert.deepEqual(orders.paths['/api/orders/{orderId}'].get.security, []);
  assert.deepEqual(orders.paths['/api/orders'].post.security, [{ betterAuthSession: [] }]);
  assert.deepEqual(identity.paths['/api/me'].get.security, [{ betterAuthSession: [] }]);
  assert.deepEqual(catalog.paths['/api/internal/catalog/products/{id}/stock'].get.security, [
    { catalogInternalToken: [] },
  ]);
  for (const doc of generatedDocuments.values()) {
    assert.equal(doc.components.securitySchemes.betterAuthSession.in, 'cookie');
    assert.equal(JSON.stringify(doc).includes('bearerFormat'), false);
  }
  assert.equal(
    catalog.paths['/api/products'].post.requestBody.content['multipart/form-data'].schema.$ref,
    '#/components/schemas/CreateProduct',
  );
  assert.equal(catalog.components.schemas.CreateProduct.required.includes('image'), true);
  assert.equal(catalog.components.schemas.UpdateProduct.required.includes('image'), false);
});
