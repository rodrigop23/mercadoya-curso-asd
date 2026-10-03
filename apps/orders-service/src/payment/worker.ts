import type { Pool, PoolClient } from 'pg';
import {
  eventSubjects,
  inventoryReservedEventSchema,
  paymentFailedEventSchema,
  paymentSucceededEventSchema,
} from '@mercadoya/contracts';
import type {
  BillingProduct,
  BillingOrderItem,
  InventoryReservedEvent,
  PaymentCheckoutResponse,
} from '@mercadoya/contracts';
import type { EventBus } from '../events/event-bus.js';
import { logEvent } from '../events/logger.js';
import {
  CheckoutRateLimited,
  CheckoutRejected,
  checkoutAmount,
  type Checkout,
  type PolarGateway,
} from './polar.js';
import type { PaymentOutcome } from './webhook.js';

type PaymentRow = {
  order_id: string;
  reservation: InventoryReservedEvent;
  state: 'queued' | 'creating' | 'open' | 'succeeded' | 'failed';
  checkout_id: string | null;
  checkout_url: string | null;
  expires_at: Date | null;
  amount: number | null;
  currency: string | null;
  product: BillingProduct | null;
  items: BillingOrderItem[] | null;
  bundle_state: 'queued' | 'creating' | 'ready';
  bundle_product_id: string | null;
};

export function createPaymentWorker(pool: Pool, eventBus: EventBus, gateway: PolarGateway) {
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  // El advisory lock del worker serializa esta preparación entre pedidos y réplicas.
  async function purchaseProduct(client: PoolClient): Promise<string | null> {
    await client.query(
      'INSERT INTO orders_payment_product(server) VALUES ($1) ON CONFLICT DO NOTHING',
      [gateway.server],
    );
    const {
      rows: [product],
    } = await client.query<{
      state: 'queued' | 'creating' | 'ready';
      product_id: string | null;
    }>('SELECT state, product_id FROM orders_payment_product WHERE server=$1', [gateway.server]);
    if (product!.state === 'ready') return product!.product_id;
    let productId = await gateway.findPurchaseProduct();
    if (!productId && product!.state === 'queued') {
      await client.query("UPDATE orders_payment_product SET state='creating' WHERE server=$1", [
        gateway.server,
      ]);
      try {
        productId = await gateway.createPurchaseProduct();
      } catch (error) {
        if (error instanceof CheckoutRateLimited || error instanceof CheckoutRejected)
          await client.query("UPDATE orders_payment_product SET state='queued' WHERE server=$1", [
            gateway.server,
          ]);
        throw error;
      }
    }
    if (productId)
      await client.query(
        "UPDATE orders_payment_product SET state='ready', product_id=$2 WHERE server=$1",
        [gateway.server, productId],
      );
    return productId;
  }
  async function enqueue(event: PaymentOutcome) {
    await pool.query(
      'INSERT INTO orders_payment_webhook(event_id, outcome) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [event.eventId, event],
    );
  }
  async function saveCheckout(client: PoolClient, orderId: string, checkout: Checkout) {
    const {
      rows: [payment],
    } = await client.query<PaymentRow>('SELECT * FROM orders_payment_checkout WHERE order_id=$1', [
      orderId,
    ]);
    if (
      payment &&
      (checkout.currency !== 'pen' ||
        checkout.amount !== checkoutAmount(payment.reservation, payment.product, payment.items))
    )
      throw new Error('polar_checkout_price_mismatch');
    await client.query(
      `UPDATE orders_payment_checkout SET state='open', checkout_id=$2, checkout_url=$3,
      expires_at=$4, amount=$5, currency=$6 WHERE order_id=$1 AND state='creating'`,
      [orderId, checkout.id, checkout.url, checkout.expires_at, checkout.amount, checkout.currency],
    );
  }
  async function processOutcome(client: PoolClient, event: PaymentOutcome) {
    await client.query('BEGIN');
    try {
      const {
        rows: [payment],
      } = await client.query<PaymentRow>(
        'SELECT * FROM orders_payment_checkout WHERE order_id=$1 FOR UPDATE',
        [event.orderId],
      );
      if (!payment || (event.checkoutId && !payment.checkout_id))
        throw new Error('checkout_not_ready');
      const mismatch = event.checkoutId && event.checkoutId !== payment.checkout_id;
      const wrongAmount =
        event.outcome === 'succeeded' &&
        (event.amount !== payment.amount || event.currency !== payment.currency);
      if (mismatch || wrongAmount || payment.state === 'succeeded' || payment.state === 'failed') {
        logEvent({
          type: 'payment.outcome_ignored',
          orderId: event.orderId,
          eventId: event.eventId,
          reason: mismatch
            ? 'checkout_mismatch'
            : wrongAmount
              ? 'amount_mismatch'
              : 'terminal_state',
        });
      } else {
        const input = {
          ...inventoryReservedEventSchema.parse(payment.reservation),
          occurredAt: event.occurredAt,
          provider: 'polar',
          eventId: event.eventId,
          checkoutId: event.checkoutId,
          providerOrderId: event.providerOrderId,
          reason: event.reason,
        };
        const succeeded = event.outcome === 'succeeded';
        // Publicar antes del commit permite reintentar con el mismo eventId si se cae el proceso.
        // El lock de sesión del worker evita publishers concurrentes entre réplicas.
        await eventBus.publish(
          succeeded ? eventSubjects.paymentSucceeded : eventSubjects.paymentFailed,
          succeeded
            ? paymentSucceededEventSchema.parse(input)
            : paymentFailedEventSchema.parse(input),
        );
        await client.query('UPDATE orders_payment_checkout SET state=$2 WHERE order_id=$1', [
          event.orderId,
          event.outcome,
        ]);
      }
      await client.query('UPDATE orders_payment_webhook SET processed_at=now() WHERE event_id=$1', [
        event.eventId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  async function run() {
    const client = await pool.connect();
    let locked = false;
    try {
      const {
        rows: [lock],
      } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(406031) AS locked');
      locked = lock!.locked;
      if (!locked) return;
      const {
        rows: [job],
      } = await client.query<{
        outcome: PaymentOutcome;
      }>(`SELECT outcome FROM orders_payment_webhook
        WHERE processed_at IS NULL AND next_attempt_at <= now() ORDER BY received_at, event_id LIMIT 1`);
      if (job) {
        try {
          await processOutcome(client, job.outcome);
        } catch {
          await client.query(
            `UPDATE orders_payment_webhook SET attempts=attempts+1,
            next_attempt_at=now()+interval '2 seconds' WHERE event_id=$1`,
            [job.outcome.eventId],
          );
          logEvent({
            type: 'payment.webhook_retry',
            eventId: job.outcome.eventId,
            orderId: job.outcome.orderId,
          });
        }
      }
      const {
        rows: [payment],
      } = await client.query<PaymentRow>(`SELECT * FROM orders_payment_checkout
        WHERE state IN ('queued', 'creating') AND next_attempt_at <= now() ORDER BY created_at LIMIT 1`);
      if (!payment) return;
      const reservation = inventoryReservedEventSchema.parse(payment.reservation);
      try {
        if (payment.state === 'queued') {
          if (reservation.items && payment.bundle_state !== 'ready') {
            let bundleId: string | null;
            checkoutAmount(reservation, payment.product, payment.items);
            // Una creación anterior al producto compartido se recupera por el pedido original.
            bundleId =
              payment.bundle_state === 'creating'
                ? await gateway.findBundle(reservation)
                : await purchaseProduct(client);
            if (!bundleId) {
              await client.query(
                "UPDATE orders_payment_checkout SET next_attempt_at=now()+interval '30 seconds' WHERE order_id=$1",
                [payment.order_id],
              );
              logEvent({ type: 'payment.product_uncertain', orderId: payment.order_id });
              return;
            }
            await client.query(
              "UPDATE orders_payment_checkout SET bundle_state='ready', bundle_product_id=$2 WHERE order_id=$1",
              [payment.order_id, bundleId],
            );
            payment.bundle_product_id = bundleId;
          }
          // Persistir la intención antes de llamar a Polar. Nunca repetir un POST incierto.
          await client.query(
            `UPDATE orders_payment_checkout SET state='creating', next_attempt_at=now()+interval '30 seconds' WHERE order_id=$1`,
            [payment.order_id],
          );
          await saveCheckout(
            client,
            payment.order_id,
            await gateway.create(
              reservation,
              payment.product,
              payment.items,
              payment.bundle_product_id,
            ),
          );
        } else {
          const recovered = await gateway.find(reservation);
          if (recovered) await saveCheckout(client, payment.order_id, recovered);
          else logEvent({ type: 'payment.checkout_uncertain', orderId: payment.order_id });
          await client.query(
            `UPDATE orders_payment_checkout SET next_attempt_at=now()+interval '30 seconds' WHERE order_id=$1`,
            [payment.order_id],
          );
        }
      } catch (error) {
        if (error instanceof CheckoutRateLimited) {
          await client.query(
            "UPDATE orders_payment_checkout SET state='queued', bundle_state=CASE WHEN bundle_product_id IS NULL THEN 'queued' ELSE bundle_state END WHERE order_id=$1",
            [payment.order_id],
          );
        }
        if (error instanceof CheckoutRejected) {
          await enqueue({
            eventId: `checkout-create:${payment.order_id}`,
            orderId: payment.order_id,
            outcome: 'failed',
            reason: error.message,
            occurredAt: new Date().toISOString(),
          });
        }
        await client.query(
          `UPDATE orders_payment_checkout SET next_attempt_at=now()+interval '30 seconds' WHERE order_id=$1`,
          [payment.order_id],
        );
        logEvent({
          type:
            error instanceof CheckoutRejected
              ? 'payment.checkout_rejected'
              : error instanceof CheckoutRateLimited
                ? 'payment.checkout_rate_limited'
                : 'payment.checkout_uncertain',
          orderId: payment.order_id,
        });
      }
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(406031)');
        client.release();
      } catch {
        client.release(true);
        logEvent({ type: 'payment.worker_connection_closed' });
      }
    }
  }
  function tick() {
    if (!active)
      active = run().finally(() => {
        active = undefined;
      });
    return active;
  }
  return {
    enqueue,
    tick,
    async onInventoryReserved(payload: unknown) {
      const event = inventoryReservedEventSchema.parse(payload);
      await pool.query(
        `INSERT INTO orders_payment_checkout(order_id, reservation, product, items)
          SELECT id, $2, payment_product, items FROM orders_order WHERE id=$1 ON CONFLICT DO NOTHING`,
        [event.orderId, event],
      );
    },
    async getCheckout(orderId: string): Promise<PaymentCheckoutResponse> {
      const {
        rows: [payment],
      } = await pool.query<PaymentRow>('SELECT * FROM orders_payment_checkout WHERE order_id=$1', [
        orderId,
      ]);
      return {
        provider: 'polar',
        checkout:
          payment?.state === 'open' &&
          payment.checkout_id &&
          payment.checkout_url &&
          payment.expires_at
            ? {
                id: payment.checkout_id,
                url: payment.checkout_url,
                expiresAt: payment.expires_at.toISOString(),
                amount: payment.amount!,
                currency: payment.currency!,
              }
            : null,
      };
    },
    start() {
      timer = setInterval(() => {
        void tick().catch(() => logEvent({ type: 'payment.worker_retry' }));
      }, 250);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      await active;
    },
  };
}
