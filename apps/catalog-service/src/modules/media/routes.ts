import { Hono } from 'hono';

export function createMediaRoutes() {
  const routes = new Hono();

  routes.get('/health', (c) => c.json({ module: 'media', ok: true }));

  return routes;
}
