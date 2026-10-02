import { timingSafeEqual } from 'node:crypto';
import { createElement } from 'react';
import { render, toPlainText } from '@react-email/render';
import { Resend } from 'resend';
import { z } from 'zod';
import {
  paymentSucceededEventSchema,
  paymentFailedEventSchema,
  inventoryRejectedEventSchema,
} from '@mercadoya/contracts';
import { OrderConfirmed } from './emails/order-confirmed.js';
import { OrderRejectedStock } from './emails/order-rejected-stock.js';
import { OrderRejectedPayment } from './emails/order-rejected-payment.js';

const invocationSchema = z.discriminatedUnion('subject', [
  z.object({ subject: z.literal('payment.succeeded'), payload: paymentSucceededEventSchema }),
  z.object({ subject: z.literal('inventory.rejected'), payload: inventoryRejectedEventSchema }),
  z.object({ subject: z.literal('payment.failed'), payload: paymentFailedEventSchema }),
]);
const intermediateSchema = z.object({
  subject: z.enum(['orders.placed', 'inventory.reserved', 'inventory.released']),
});
export type NotificationInvocation = z.infer<typeof invocationSchema>;
type HttpEvent = {
  body: string | null;
  headers: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
};

// Limita el envío al timeout del handler y del bridge.
class NotificationsResend extends Resend {
  override fetchRequest<T>(path: string, options: RequestInit = {}) {
    return super.fetchRequest<T>(path, { ...options, signal: AbortSignal.timeout(5_000) });
  }
}

function validToken(expected: string | undefined, received: string | undefined) {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function emailFor({ subject, payload }: NotificationInvocation) {
  switch (subject) {
    case 'payment.succeeded':
      return { subject: 'Pedido confirmado', component: createElement(OrderConfirmed, payload) };
    case 'inventory.rejected':
      return {
        subject: 'No pudimos completar tu pedido',
        component: createElement(OrderRejectedStock, payload),
      };
    case 'payment.failed':
      return {
        subject: 'El pago no se completó',
        component: createElement(OrderRejectedPayment, payload),
      };
  }
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
  if (intermediateSchema.safeParse(input).success) {
    return { statusCode: 202, body: JSON.stringify({ ok: true, ignored: true }) };
  }
  const parsed = invocationSchema.safeParse(input);
  if (!parsed.success) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Evento inválido.' }) };
  }
  const { subject, payload } = parsed.data;
  const email = emailFor(parsed.data);
  const html = await render(email.component);
  const body = toPlainText(html);
  // Identity solo expone la sesión del usuario; buyerId no es una dirección de correo.
  const recipient = process.env.DEMO_NOTIFY_EMAIL?.trim();
  const key = process.env.RESEND_API_KEY?.trim();
  const mode = process.env.EMAIL_MODE?.trim() || (key ? 'resend' : 'stub');
  let emailStatus: 'stub' | 'sent' | 'error' = 'stub';
  let emailId: string | undefined;
  let stubReason: string | undefined;
  try {
    if (!recipient) stubReason = 'missing_recipient';
    else if (mode === 'stub') stubReason = 'email_mode_stub';
    else {
      if (mode !== 'resend') throw new Error('EMAIL_MODE debe ser stub o resend.');
      const from = process.env.RESEND_FROM?.trim();
      if (!key || !from) throw new Error('Configura RESEND_API_KEY y RESEND_FROM.');
      const { data, error } = await new NotificationsResend(key).emails.send(
        { from, to: recipient, subject: email.subject, html, text: body },
        { idempotencyKey: `${subject}/${payload.orderId}` },
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Resend no devolvió el identificador del correo.');
      emailStatus = 'sent';
      emailId = data.id;
    }
  } catch (error) {
    emailStatus = 'error';
    console.error(
      JSON.stringify({
        step: 'notification.email_error',
        orderId: payload.orderId,
        subject,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const notification = {
    type: emailStatus === 'stub' ? 'notification.stub' : 'notification.email',
    subject,
    transport: 'lambda',
    orderId: payload.orderId,
    recipient: recipient || 'guest',
    notificationSubject: email.subject,
    body,
    emailStatus,
    emailId,
    stubReason,
    ...(emailStatus === 'error' ? { emailError: true } : {}),
  };
  console.info(JSON.stringify({ step: 'notification.created', ...notification }));
  return { statusCode: 202, body: JSON.stringify({ ok: true }) };
}
