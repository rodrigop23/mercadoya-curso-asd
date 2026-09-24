import { Hono } from 'hono';

export function createOrdersRoutes() {
  const routes = new Hono();

  routes.get('/health', (c) => c.json({ module: 'orders', ok: true }));

  return routes;
}
