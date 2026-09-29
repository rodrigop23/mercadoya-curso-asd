import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createCatalogModule } from './modules/catalog/index.js';
import { createIdentityModule } from './modules/identity/index.js';
import { createMediaModule } from './modules/media/index.js';
import { createNotificationsModule } from './modules/notifications/index.js';
import type { EventBus } from './events/event-bus.js';
import { createEventsRoutes } from './events/routes.js';

export async function createApiLayer(eventBus: EventBus) {
  const identity = createIdentityModule();
  const media = createMediaModule();
  const catalog = createCatalogModule(identity.contract, media.contract);
  const notifications = createNotificationsModule(eventBus.transport);
  const app = new Hono();

  await eventBus.subscribe(
    'orders.placed',
    'notifications.order-placed',
    notifications.onOrderPlaced,
  );
  await eventBus.subscribe(
    'inventory.reserved',
    'notifications.order-confirmed',
    notifications.onInventoryReserved,
  );
  await eventBus.subscribe(
    'inventory.rejected',
    'notifications.order-rejected',
    notifications.onInventoryRejected,
  );

  app.use('/api/*', cors({ origin: 'http://localhost:5173', credentials: true }));
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
        const response = await fetch(upstream, {
          method: c.req.raw.method,
          headers,
          body: c.req.raw.body,
          duplex: 'half',
        } as RequestInit);
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
  const proxyInventory = proxyService(
    process.env.INVENTORY_SERVICE_URL || 'http://localhost:3003',
    'Inventory',
  );
  app.all('/api/orders', proxyOrders);
  app.all('/api/orders/*', proxyOrders);
  app.route('/api/events', createEventsRoutes());
  app.all('/api/inventory', proxyInventory);
  app.all('/api/inventory/*', proxyInventory);
  app.route('/api/notifications', notifications.routes);

  return app;
}
