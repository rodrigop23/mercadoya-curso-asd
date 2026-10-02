import { webhooks } from '@polar-sh/sdk/2026-04';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

const envelope = z.object({
  type: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.unknown(),
});
const common = {
  id: z.uuid(),
  metadata: z.object({ order_id: z.uuid() }),
};
const checkout = z.object({
  ...common,
  status: z.enum(['open', 'confirmed', 'succeeded', 'failed', 'expired']),
});
const order = z.object({
  ...common,
  checkout_id: z.uuid(),
  status: z.enum(['draft', 'pending', 'paid', 'refunded', 'partially_refunded', 'void']),
  paid: z.boolean(),
  subtotal_amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export type PaymentOutcome = {
  eventId: string;
  orderId: string;
  checkoutId?: string;
  providerOrderId?: string;
  outcome: 'succeeded' | 'failed';
  occurredAt: string;
  reason?: string;
  amount?: number;
  currency?: string;
};

// El SDK v1 valida firma y tipo, pero no valida la estructura JSON en runtime.
export function mapPolarEvent(payload: unknown, eventId: string): PaymentOutcome | null {
  const event = envelope.parse(payload);
  const occurredAt = new Date(event.timestamp).toISOString();
  // El endpoint puede recibir compras de otros productos de la misma organización.
  if (typeof event.data === 'object' && event.data !== null && 'metadata' in event.data) {
    const metadata = event.data.metadata;
    if (typeof metadata === 'object' && metadata !== null && !('order_id' in metadata)) return null;
  }
  if (event.type === 'order.paid' || event.type === 'order.updated') {
    const data = order.parse(event.data);
    if (event.type === 'order.paid' && (data.status !== 'paid' || !data.paid))
      throw new Error('order.paid incompatible');
    if (event.type === 'order.paid' && data.status === 'paid' && data.paid) {
      return {
        eventId,
        occurredAt,
        orderId: data.metadata.order_id,
        checkoutId: data.checkout_id,
        providerOrderId: data.id,
        outcome: 'succeeded',
        amount: data.subtotal_amount,
        currency: data.currency,
      };
    }
    if (data.status === 'void' && !data.paid) {
      return {
        eventId,
        occurredAt,
        orderId: data.metadata.order_id,
        checkoutId: data.checkout_id,
        providerOrderId: data.id,
        outcome: 'failed',
        reason: 'polar_order_void',
      };
    }
    return null;
  }
  if (event.type === 'checkout.updated' || event.type === 'checkout.expired') {
    const data = checkout.parse(event.data);
    if (data.status === 'expired' || data.status === 'failed') {
      return {
        eventId,
        occurredAt,
        orderId: data.metadata.order_id,
        checkoutId: data.id,
        outcome: 'failed',
        reason: data.status === 'expired' ? 'polar_checkout_expired' : 'polar_checkout_failed',
      };
    }
  }
  return null;
}

export function createPolarWebhookRoutes(
  secret: string,
  enqueue: (event: PaymentOutcome) => Promise<void>,
) {
  const routes = new Hono();
  routes.use(
    '*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => c.json({ error: 'Payload demasiado grande.' }, 413),
    }),
  );
  routes.post('/', async (c) => {
    let payload: unknown;
    const eventId = c.req.header('webhook-id') ?? '';
    try {
      payload = await webhooks.validateEvent(
        await c.req.text(),
        {
          'webhook-id': eventId,
          'webhook-timestamp': c.req.header('webhook-timestamp') ?? '',
          'webhook-signature': c.req.header('webhook-signature') ?? '',
        },
        secret,
      );
    } catch (error) {
      if (error instanceof webhooks.PolarWebhookVerificationError)
        return c.json({ error: 'Firma inválida.' }, 403);
      return c.json({ error: 'Evento Polar inválido o versión incompatible.' }, 400);
    }
    let outcome: PaymentOutcome | null;
    try {
      if (eventId.length > 200) throw new Error('event id inválido');
      outcome = mapPolarEvent(payload, eventId);
    } catch {
      return c.json({ error: 'Payload Polar inválido.' }, 400);
    }
    try {
      if (outcome) await enqueue(outcome);
      return c.json({ received: true }, 202);
    } catch {
      // No ACK sin persistir. Polar puede repetir la entrega con el mismo webhook-id.
      return c.json({ error: 'No se pudo aceptar el evento.' }, 503);
    }
  });
  return routes;
}
