import { createPolar } from '@polar-sh/sdk/2026-04';
import { PolarClientError } from '@polar-sh/sdk';
import {
  billingProductSchema,
  billingOrderItemSchema,
  type BillingOrderItem,
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
  readonly server: PolarConfig['server'];
  create(
    event: InventoryReservedEvent,
    product: BillingProduct | null,
    items?: BillingOrderItem[] | null,
    bundleProductId?: string | null,
  ): Promise<Checkout>;
  find(event: InventoryReservedEvent): Promise<Checkout | null>;
  createPurchaseProduct(): Promise<string>;
  findPurchaseProduct(): Promise<string | null>;
  findBundle(event: InventoryReservedEvent): Promise<string | null>;
}

export class CheckoutRejected extends Error {}
export class CheckoutRateLimited extends Error {}

export function checkoutAmount(
  event: InventoryReservedEvent,
  snapshot: BillingProduct | null,
  items?: BillingOrderItem[] | null,
) {
  let amount: number;
  if (event.items) {
    const lines = billingOrderItemSchema.array().safeParse(items);
    if (
      !lines.success ||
      lines.data.length !== event.items.length ||
      lines.data.some(
        (item, index) =>
          item.productId !== event.items![index]!.productId ||
          item.quantity !== event.items![index]!.quantity,
      )
    )
      throw new CheckoutRejected('polar_price_unavailable');
    amount = lines.data.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
  } else {
    const product = billingProductSchema.safeParse(snapshot);
    if (!product.success || product.data.productId !== event.productId)
      throw new CheckoutRejected('polar_price_unavailable');
    amount = product.data.unitAmount * event.quantity;
  }
  if (!Number.isSafeInteger(amount) || amount < 200 || amount > 99_999_999)
    throw new CheckoutRejected('polar_amount_invalid');
  return amount;
}

function providerError(error: unknown): never {
  if (error instanceof PolarClientError && error.statusCode === 429)
    throw new CheckoutRateLimited('polar_rate_limited');
  if (error instanceof PolarClientError && error.statusCode < 500)
    throw new CheckoutRejected('polar_checkout_rejected');
  throw new Error('polar_checkout_uncertain');
}

export function createPolarGateway(config: PolarConfig): PolarGateway {
  const polar = createPolar({
    accessToken: config.accessToken,
    environment: config.server,
    timeout: 5,
  });
  return {
    server: config.server,
    async createPurchaseProduct() {
      try {
        const product = await polar.products.create({
          name: 'Compra en MercadoYa',
          description:
            'Compra de productos en MercadoYa. El desglose está disponible en tu pedido.',
          recurring_interval: null,
          visibility: 'private',
          prices: [
            {
              amount_type: 'custom',
              price_currency: 'pen',
              minimum_amount: 200,
              tax_behavior: 'exclusive',
            },
          ],
          metadata: { mercadoya_checkout: 'purchase' },
        });
        return product.id;
      } catch (error) {
        providerError(error);
      }
    },
    async findPurchaseProduct() {
      try {
        let found: string | null = null;
        for await (const product of polar.products.iterList({
          metadata: { mercadoya_checkout: 'purchase' },
          limit: 100,
        })) {
          if (product.metadata.mercadoya_checkout !== 'purchase') continue;
          if (
            found ||
            product.is_recurring ||
            product.is_archived ||
            product.visibility !== 'private'
          )
            throw new CheckoutRejected('polar_purchase_product_invalid');
          found = product.id;
        }
        return found;
      } catch (error) {
        if (error instanceof CheckoutRejected) throw error;
        providerError(error);
      }
    },
    async findBundle(event) {
      let found: string | null = null;
      for await (const product of polar.products.iterList({
        metadata: { mercadoya_order_id: event.orderId },
        limit: 100,
      })) {
        if (product.metadata.mercadoya_order_id !== event.orderId) continue;
        if (found || product.is_recurring || product.is_archived)
          throw new CheckoutRejected('polar_bundle_invalid');
        found = product.id;
      }
      return found;
    },
    async create(event, snapshot, items, bundleProductId) {
      const amount = checkoutAmount(event, snapshot, items);
      const polarProductId = event.items ? bundleProductId : snapshot?.polarProductId;
      if (!polarProductId) throw new CheckoutRejected('polar_price_unavailable');
      const returnUrl = new URL(`/orders/${event.orderId}`, config.webOrigin).href;
      try {
        return await polar.checkouts.create({
          products: [polarProductId],
          currency: 'pen',
          locale: 'es-PE',
          external_customer_id: event.buyerId ?? `order:${event.orderId}`,
          metadata: {
            order_id: event.orderId,
            product_id: event.productId,
            quantity: event.quantity,
          },
          prices: {
            [polarProductId]: [
              {
                amount_type: 'fixed',
                price_currency: 'pen',
                price_amount: amount,
                tax_behavior: 'exclusive',
              },
            ],
          },
          allow_discount_codes: false,
          allow_trial: false,
          success_url: `${returnUrl}?checkout_id={CHECKOUT_ID}`,
          return_url: event.items ? new URL('/cart', config.webOrigin).href : returnUrl,
        });
      } catch (error) {
        providerError(error);
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
