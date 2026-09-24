import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createCatalogModule } from './modules/catalog/index.js';
import { createIdentityModule } from './modules/identity/index.js';
import { createInventoryModule } from './modules/inventory/index.js';
import { createMediaModule } from './modules/media/index.js';
import { createNotificationsModule } from './modules/notifications/index.js';
import { createOrdersModule } from './modules/orders/index.js';

export function createApiLayer() {
  const identity = createIdentityModule();
  const media = createMediaModule();
  const catalog = createCatalogModule(identity.contract, media.contract);
  const orders = createOrdersModule();
  const inventory = createInventoryModule();
  const notifications = createNotificationsModule();
  const app = new Hono();

  app.use('/api/*', cors({ origin: 'http://localhost:5173', credentials: true }));
  app.get('/', (c) => c.text('MercadoYa API está lista.'));

  // Identity and Catalog keep their V1 URLs. New modules mount below their API prefixes.
  app.route('/', identity.routes);
  app.route('/', catalog.routes);
  app.route('/api/media', media.routes);
  app.route('/api/orders', orders.routes);
  app.route('/api/inventory', inventory.routes);
  app.route('/api/notifications', notifications.routes);

  return app;
}
