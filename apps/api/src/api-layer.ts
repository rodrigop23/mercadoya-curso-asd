import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createCatalogModule } from './modules/catalog/index.js';
import { identityContract } from './modules/identity/service.js';
import { createMediaModule } from './modules/media/index.js';
import { createEventsRoutes } from './events/routes.js';

export function createApiLayer() {
  const media = createMediaModule();
  const catalog = createCatalogModule(identityContract, media.contract);
  const app = new Hono();

  app.use(
    '/api/*',
    cors({ origin: ['http://localhost:5173', 'http://localhost:5174'], credentials: true }),
  );
  app.get('/', (c) => c.text('MercadoYa API está lista.'));

  app.route('/', catalog.routes);
  app.route('/api/media', media.routes);
  app.route('/api/events', createEventsRoutes());

  return app;
}
