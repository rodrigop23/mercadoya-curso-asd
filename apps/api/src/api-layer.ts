import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createTokenVerifier } from '@mercadoya/jwt-verifier';
import { createEventsRoutes } from './events/routes.js';

export function createApiLayer() {
  const app = new Hono();
  const verify = createTokenVerifier();
  app.use(
    '/api/*',
    cors({ origin: ['http://localhost:5173', 'http://localhost:5174'], credentials: true }),
  );
  app.get('/', (c) => c.text('MercadoYa timeline API está lista.'));
  app.get('/api/events/health', (c) => c.json({ module: 'events', ok: true }));
  app.use('/api/events', async (c, next) => {
    if (!(await verify(c.req.header('authorization') ?? null)))
      return c.json({ error: 'Unauthorized' }, 401);
    await next();
  });
  app.route('/api/events', createEventsRoutes());
  return app;
}
