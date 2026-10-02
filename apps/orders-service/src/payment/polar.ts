import { createPolar } from '@polar-sh/sdk/2026-04';
import { PolarClientError } from '@polar-sh/sdk';
import {
  billingProductSchema,
  type BillingProduct,
  type InventoryReservedEvent,
} from '@mercadoya/contracts';
import type { PolarConfig } from './config.js';

export type Checkout = {
  id: string;
  url: string;
  expires_at: string;
  amount: number;
  currency: string;
  status: string;
};
export interface PolarGateway {
  create(event: InventoryReservedEvent, product: BillingProduct | null): Promise<Checkout>;
  find(event: InventoryReservedEvent): Promise<Checkout | null>;
}

export class CheckoutRejected extends Error {}
export class CheckoutRateLimited extends Error {}

export function createPolarGateway(config: PolarConfig): PolarGateway {
  const polar = createPolar({
    accessToken: config.accessToken,
    environment: config.server,
    timeout: 5,
  });
  return {
    async create(event, snapshot) {
      const parsed = billingProductSchema.safeParse(snapshot);
      if (!parsed.success || parsed.data.productId !== event.productId)
        throw new CheckoutRejected('polar_price_unavailable');
      const product = parsed.data;
      const amount = product.unitAmount * event.quantity;
      if (!Number.isSafeInteger(amount) || amount > 99_999_999)
        throw new CheckoutRejected('polar_amount_invalid');
      const returnUrl = new URL(`/orders/${event.orderId}`, config.webOrigin).href;
      try {
        return await polar.checkouts.create({
          products: [product.polarProductId],
          currency: 'pen',
          locale: 'es-PE',
          external_customer_id: event.buyerId ?? `order:${event.orderId}`,
          metadata: {
            order_id: event.orderId,
            product_id: event.productId,
            quantity: event.quantity,
          },
          prices: {
            [product.polarProductId]: [
              {
                amount_type: 'fixed',
                price_currency: product.currency,
                price_amount: amount,
                tax_behavior: 'exclusive',
              },
            ],
          },
          allow_discount_codes: false,
          allow_trial: false,
          success_url: `${returnUrl}?checkout_id={CHECKOUT_ID}`,
          return_url: returnUrl,
        });
      } catch (error) {
        if (error instanceof PolarClientError && error.statusCode === 429)
          throw new CheckoutRateLimited('polar_rate_limited');
        // Un error de transporte/5xx puede haber creado la sesión; no liberar ni crear otra.
        if (error instanceof PolarClientError && error.statusCode !== 429) {
          throw new CheckoutRejected('polar_checkout_rejected');
        }
        throw new Error('polar_checkout_uncertain');
      }
    },
    async find(event) {
      for await (const checkout of polar.checkouts.iterList({
        external_customer_id: event.buyerId ?? `order:${event.orderId}`,
        limit: 100,
      })) {
        if (checkout.metadata.order_id === event.orderId) return checkout;
      }
      return null;
    },
  };
}
