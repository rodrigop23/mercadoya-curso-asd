import { Hono } from 'hono';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';

import { getRecentEvents } from './recent-store.js';
import { logEvent } from './logger.js';

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  orderId: z.string().uuid().optional(),
});

const notificationSchema = z.strictObject({
  type: z.enum(['notification.stub', 'notification.email']),
  emailStatus: z.enum(['stub', 'sent', 'error']),
  emailError: z.boolean().optional(),
  emailId: z.string().optional(),
  stubReason: z.string().optional(),
  orderId: z.string().uuid(),
  recipient: z.string().min(1),
  notificationSubject: z.string().min(1),
  body: z.string().min(1),
  transport: z.literal('lambda'),
  subject: z.enum(['payment.succeeded', 'inventory.rejected', 'payment.failed']),
});

function authorized(token: string | undefined, received: string | undefined) {
  if (!token || !received) return false;
  const expectedBytes = Buffer.from(token);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export function createEventsRoutes() {
  const routes = new Hono();

  routes.post('/ingest', async (c) => {
    const token = process.env.NOTIFICATIONS_INGEST_TOKEN;
    if (!token) return c.json({ error: 'Ingest no configurado.' }, 503);
    if (!authorized(token, c.req.header('x-ingest-token'))) {
      return c.json({ error: 'Token de ingest inválido.' }, 401);
    }
    const json = await c.req.json().catch(() => null);
    const parsed = notificationSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: 'Evento de notificación inválido.' }, 400);
    logEvent(parsed.data);
    return c.json({ ok: true }, 202);
  });

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
