import { Hono } from 'hono';

export function createInventoryRoutes() {
  const routes = new Hono();

  routes.get('/health', (c) => c.json({ module: 'inventory', ok: true }));

  return routes;
}
