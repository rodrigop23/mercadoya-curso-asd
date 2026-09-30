import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { createAdminAuthorizer } from './auth.js';
import { createCatalogModule } from './modules/catalog/index.js';
import { createMediaModule } from './modules/media/index.js';

export function createApp() {
  const media = createMediaModule();
  const catalog = createCatalogModule(createAdminAuthorizer(), media.contract);
  const app = new Hono();
  app.use(
    '/api/*',
    cors({ origin: ['http://localhost:5173', 'http://localhost:5174'], credentials: true }),
  );
  app.use(
    '/api/products/*',
    bodyLimit({
      maxSize: 3 * 1024 * 1024,
      onError: (c) => c.json({ error: 'El formulario no puede superar los 3 MB.' }, 413),
    }),
  );
  app.route('/', catalog.routes);
  app.route('/api/media', media.routes);
  return app;
}
