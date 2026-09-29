import { Hono } from 'hono';
import { z } from 'zod';

import { getRecentEvents } from './recent-store.js';

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  orderId: z.string().uuid().optional(),
});

export function createEventsRoutes() {
  const routes = new Hono();

  routes.get('/', (c) => {
    const parsed = eventsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        {
          error: 'Revisa los filtros de eventos.',
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    // The API returns newest first; order pages can reverse this for process playback.
    return c.json({ events: getRecentEvents(parsed.data) });
  });

  return routes;
}
