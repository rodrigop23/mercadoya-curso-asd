import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createCatalogModule } from './modules/catalog/index.js';
import { createIdentityModule } from './modules/identity/index.js';
import { createMediaModule } from './modules/media/index.js';
import { createEventsRoutes } from './events/routes.js';

export function createApiLayer() {
  const identity = createIdentityModule();
  const media = createMediaModule();
  const catalog = createCatalogModule(identity.contract, media.contract);
  const app = new Hono();

  app.use(
    '/api/*',
    cors({ origin: ['http://localhost:5173', 'http://localhost:5174'], credentials: true }),
  );
  app.get('/', (c) => c.text('MercadoYa API está lista.'));

  // Identity and Catalog keep their V1 URLs. New modules mount below their API prefixes.
  app.route('/', identity.routes);
  app.route('/', catalog.routes);
  app.route('/api/media', media.routes);
  const proxyService =
    (baseUrl: string, serviceName: string) => async (c: { req: { raw: Request } }) => {
      const upstream = new URL(baseUrl);
      const source = new URL(c.req.raw.url);
      upstream.pathname = source.pathname;
      upstream.search = source.search;
      const headers = new Headers(c.req.raw.headers);
      headers.delete('host');
      headers.delete('content-length');
      try {
        const body = ['GET', 'HEAD'].includes(c.req.raw.method)
          ? undefined
          : await c.req.raw.arrayBuffer();
        const response = await fetch(upstream, {
          method: c.req.raw.method,
          headers,
          body,
        });
        return response;
      } catch (error) {
        console.error(`No se pudo contactar ${serviceName}:`, error);
        return new Response(JSON.stringify({ error: `${serviceName} no está disponible.` }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
    };
  const proxyOrders = proxyService(
    process.env.ORDERS_SERVICE_URL || 'http://localhost:3002',
    'Orders',
  );
  const proxyInventoryV1 = proxyService(
    process.env.INVENTORY_V1_URL || 'http://localhost:3003',
    'Inventory v1',
  );
  const proxyInventoryV2 = proxyService(
    process.env.INVENTORY_V2_URL || 'http://localhost:3005',
    'Inventory v2',
  );
  const proxyNotifications = proxyService(
    process.env.NOTIFICATIONS_BRIDGE_URL || 'http://localhost:3004',
    'Notifications bridge',
  );
  app.all('/api/orders', proxyOrders);
  app.all('/api/orders/*', proxyOrders);
  app.route('/api/events', createEventsRoutes());
  app.all('/api/inventory/v1', proxyInventoryV1);
  app.all('/api/inventory/v1/*', proxyInventoryV1);
  app.all('/api/inventory/v2', proxyInventoryV2);
  app.all('/api/inventory/v2/*', proxyInventoryV2);
  app.all('/api/inventory', proxyInventoryV2);
  app.all('/api/inventory/*', proxyInventoryV2);
  app.all('/api/notifications', proxyNotifications);
  app.all('/api/notifications/*', proxyNotifications);

  return app;
}
