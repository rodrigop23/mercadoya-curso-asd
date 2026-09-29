import { Hono } from 'hono';

export function createNotificationsRoutes() {
  const routes = new Hono();

  routes.get('/health', (c) => c.json({ module: 'notifications', ok: true }));

  return routes;
}
