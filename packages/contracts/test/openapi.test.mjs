import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { generatedDocuments } from '../scripts/openapi.mjs';

const inventory = generatedDocuments.get('apps/inventory-service/openapi.yaml');
const orders = generatedDocuments.get('apps/orders-service/openapi.yaml');
const identity = generatedDocuments.get('apps/identity-service/openapi.yaml');
const catalog = generatedDocuments.get('apps/catalog-service/openapi/catalog.yaml');

test('checkout requiere auth y webhook documenta firma pública y ACK async', () => {
  const checkout = orders.paths['/api/orders/{orderId}/checkout'].get;
  assert.deepEqual(checkout.security, [{ betterAuthSession: [] }, { applicationJWT: [] }]);
  assert.ok(checkout.responses[202]);
  const webhook = orders.paths['/api/payments/polar/webhook'].post;
  assert.deepEqual(webhook.security, []);
  assert.deepEqual(
    webhook.parameters.map((header) => header.name),
    ['webhook-id', 'webhook-timestamp', 'webhook-signature'],
  );
  for (const status of [202, 400, 403, 413, 503]) assert.ok(webhook.responses[status]);
});

test('Inventory anuncia un despliegue y un contrato sin deprecaciones', () => {
  assert.deepEqual(Object.keys(inventory.paths).sort(), [
    '/api/inventory/health',
    '/api/inventory/reservations/{orderId}',
  ]);
  assert.deepEqual(Object.keys(inventory.components.schemas).sort(), [
    'Error',
    'ReservationResponse',
  ]);
  for (const path of Object.values(inventory.paths)) {
    assert.deepEqual(
      path.servers.map((server) => server.url),
      ['http://localhost:8000', 'http://localhost:3003'],
    );
    assert.equal(path.get.deprecated, undefined);
    for (const response of Object.values(path.get.responses))
      assert.equal(response.headers, undefined);
  }
  const reservation = inventory.paths['/api/inventory/reservations/{orderId}'].get;
  assert.equal(
    reservation.responses[200].content['application/json'].schema.$ref,
    '#/components/schemas/ReservationResponse',
  );
});

test('los bordes documentados distinguen sesión browser, JWT y token interno de stock', () => {
  assert.deepEqual(orders.paths['/api/orders'].get.security, [
    { betterAuthSession: [] },
    { applicationJWT: [] },
  ]);
  assert.equal(
    orders.paths['/api/orders'].get.responses[200].content['application/json'].schema.$ref,
    '#/components/schemas/OrdersResponse',
  );
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
  for (const suffix of ['stock', 'adjust-stock', 'billing']) {
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

test('Compose y Kong configuran un único Inventory y solo las rutas vigentes', () => {
  const root = new URL('../../../', import.meta.url);
  const compose = parse(readFileSync(new URL('docker-compose.yml', root), 'utf8'));
  const kong = parse(readFileSync(new URL('infra/kong/kong.yml', root), 'utf8'));
  assert.deepEqual(
    Object.keys(compose.services).filter((name) => name.startsWith('inventory')),
    ['inventory'],
  );
  assert.deepEqual(compose.services.inventory.ports, ['127.0.0.1:3003:3003']);
  assert.equal(compose.services.inventory.environment.SERVICE_VERSION, undefined);
  const services = kong.services.filter((service) => service.name.startsWith('inventory'));
  assert.equal(services.length, 1);
  assert.equal(services[0].url, 'http://inventory:3003');
  assert.deepEqual(
    services[0].routes.flatMap((route) => route.paths),
    ['~/api/inventory/health$', '~/api/inventory/reservations/[^/]+$'],
  );
  const dockerfile = readFileSync(new URL('apps/inventory-service/Dockerfile', root), 'utf8');
  assert.ok(dockerfile.includes('http://127.0.0.1:3003/api/inventory/health'));
  assert.equal(dockerfile.includes('SERVICE_VERSION'), false);
});
