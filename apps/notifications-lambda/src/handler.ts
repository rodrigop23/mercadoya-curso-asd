import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const order = {
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
};

const invocationSchema = z.discriminatedUnion('subject', [
  z.object({ subject: z.literal('orders.placed'), payload: z.object(order) }),
  z.object({ subject: z.literal('inventory.reserved'), payload: z.object(order) }),
  z.object({
    subject: z.literal('inventory.rejected'),
    payload: z.object({
      ...order,
      reason: z.enum([
        'invalid_quantity',
        'product_not_found',
        'insufficient_stock',
        'stock_limit',
      ]),
    }),
  }),
]);

export type NotificationInvocation = z.infer<typeof invocationSchema>;

type HttpEvent = {
  body: string | null;
  headers: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
};

function validToken(expected: string | undefined, received: string | undefined) {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function notificationFor(invocation: NotificationInvocation) {
  const { subject, payload } = invocation;
  const common = {
    type: 'notification.stub' as const,
    subject,
    transport: 'lambda' as const,
    orderId: payload.orderId,
    recipient: payload.buyerId ?? 'guest',
  };
  if (subject === 'orders.placed') {
    return {
      ...common,
      notificationSubject: 'Recibimos tu pedido',
      body: `El pedido ${payload.orderId} está pendiente de reserva de stock.`,
    };
  }
  if (subject === 'inventory.reserved') {
    return {
      ...common,
      notificationSubject: 'Pedido confirmado',
      body: `El pedido ${payload.orderId} quedó confirmado.`,
    };
  }
  return {
    ...common,
    notificationSubject: 'Pedido rechazado',
    body: `El pedido ${payload.orderId} fue rechazado: ${payload.reason}.`,
  };
}

export async function handler(event: HttpEvent) {
  if (!validToken(process.env.NOTIFICATIONS_INVOKE_TOKEN, event.headers['x-invoke-token'])) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token de invocación inválido.' }) };
  }

  let input: unknown;
  try {
    const body = event.body ?? '';
    input = JSON.parse(event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido.' }) };
  }
  const parsed = invocationSchema.safeParse(input);
  if (!parsed.success) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Evento inválido.' }) };
  }

  const ingestUrl = process.env.EVENTS_INGEST_URL;
  const ingestToken = process.env.NOTIFICATIONS_INGEST_TOKEN;
  if (!ingestUrl || !ingestToken)
    throw new Error('Configura EVENTS_INGEST_URL y NOTIFICATIONS_INGEST_TOKEN.');

  const notification = notificationFor(parsed.data);
  console.info(JSON.stringify({ step: 'notification.created', ...notification }));
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-token': ingestToken },
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Timeline ingest respondió ${response.status}.`);
  console.info(
    JSON.stringify({
      step: 'notification.ingested',
      orderId: notification.orderId,
      subject: notification.subject,
    }),
  );
  return { statusCode: 202, body: JSON.stringify({ ok: true }) };
}
