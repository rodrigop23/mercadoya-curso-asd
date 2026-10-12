import type { PoolClient } from 'pg';
import type { PaymentOutcome } from '../payment/webhook.js';
import type { OrderStatus } from './schema.js';

export function orderLifecycleConfig(env = process.env) {
  const minutes = Number(env.ORDER_PENDING_TTL_MINUTES ?? 15);
  const graceSeconds = Number(env.ORDER_EXPIRY_GRACE_SECONDS ?? 120);
  if (!Number.isSafeInteger(minutes) || minutes <= 0)
    throw new Error('ORDER_PENDING_TTL_MINUTES debe ser un entero positivo.');
  if (!Number.isSafeInteger(graceSeconds) || graceSeconds < 0)
    throw new Error('ORDER_EXPIRY_GRACE_SECONDS debe ser un entero no negativo.');
  return { minutes, graceSeconds };
}

export type LockedOrder = {
  id: string;
  buyer_id: string | null;
  status: OrderStatus;
  expires_at: Date | null;
  updated_at: Date;
};
export type CancelResult = 'cancelled' | 'already_cancelled' | 'not_found' | 'conflict';
export type OrderCloseStatus = 'cancelled' | 'expired';

export async function lockOrder(client: PoolClient, orderId: string) {
  const {
    rows: [order],
  } = await client.query<LockedOrder>('SELECT * FROM orders_order WHERE id=$1 FOR UPDATE', [
    orderId,
  ]);
  return order;
}

export async function enqueueOrderClose(
  client: PoolClient,
  order: LockedOrder,
  checkoutId?: string | null,
) {
  const cancelled = order.status === 'cancelled';
  const event: PaymentOutcome = {
    eventId: `${cancelled ? 'order-cancel' : 'order-expire'}:${order.id}`,
    orderId: order.id,
    outcome: 'failed',
    reason: cancelled ? 'order_cancelled' : 'order_expired',
    occurredAt: order.updated_at.toISOString(),
    ...(checkoutId ? { checkoutId } : {}),
  };
  await client.query(
    'INSERT INTO orders_payment_webhook(event_id, outcome) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [event.eventId, event],
  );
}

// El caller inicia la transacción y bloquea primero el pedido, luego el checkout.
export async function closePendingOrder(
  client: PoolClient,
  order: LockedOrder,
  status: OrderCloseStatus,
) {
  const {
    rows: [payment],
  } = await client.query<{ checkout_id: string | null; state: string }>(
    'SELECT * FROM orders_payment_checkout WHERE order_id=$1 FOR UPDATE',
    [order.id],
  );
  if (order.status !== 'pending' || payment?.state === 'succeeded') return false;
  const {
    rows: [closed],
  } = await client.query<LockedOrder>(
    `UPDATE orders_order SET status=$2, rejection_reason=$3, updated_at=now(),
      cancelled_at=CASE WHEN $2='cancelled' THEN now() ELSE cancelled_at END
      WHERE id=$1 AND status='pending' RETURNING *`,
    [order.id, status, status === 'cancelled' ? 'order_cancelled' : 'order_expired'],
  );
  if (!closed) return false;
  if (payment) await enqueueOrderClose(client, closed, payment.checkout_id);
  return true;
}
