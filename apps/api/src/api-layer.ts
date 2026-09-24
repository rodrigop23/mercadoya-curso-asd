import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createCatalogModule } from './modules/catalog/index.js';
import { createIdentityModule } from './modules/identity/index.js';
import { createInventoryModule } from './modules/inventory/index.js';
import { createMediaModule } from './modules/media/index.js';
import { createNotificationsModule } from './modules/notifications/index.js';
import { createOrdersModule } from './modules/orders/index.js';
import type { EventBus } from './events/event-bus.js';
import {
  inventoryRejectedEventSchema,
  inventoryReservedEventSchema,
} from './modules/inventory/events.js';

export async function createApiLayer(eventBus: EventBus) {
  const identity = createIdentityModule();
  const media = createMediaModule();
  const catalog = createCatalogModule(identity.contract, media.contract);
  const inventory = createInventoryModule(catalog.contract, eventBus);
  const orders = createOrdersModule(eventBus, identity.contract);
  const notifications = createNotificationsModule();
  const app = new Hono();

  await eventBus.subscribe('orders.placed', 'inventory.reserve', inventory.onOrderPlaced);
  await eventBus.subscribe(
    'orders.placed',
    'notifications.order-placed',
    notifications.onOrderPlaced,
  );
  await eventBus.subscribe('inventory.reserved', 'orders.confirm', (payload: unknown) =>
    orders.onInventoryReserved(inventoryReservedEventSchema.parse(payload)),
  );
  await eventBus.subscribe(
    'inventory.reserved',
    'notifications.order-confirmed',
    notifications.onInventoryReserved,
  );
  await eventBus.subscribe('inventory.rejected', 'orders.reject', (payload: unknown) =>
    orders.onInventoryRejected(inventoryRejectedEventSchema.parse(payload)),
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
  app.route('/api/orders', orders.routes);
  app.route('/api/inventory', inventory.routes);
  app.route('/api/notifications', notifications.routes);

  return app;
}
