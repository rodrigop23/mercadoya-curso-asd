import { createPolar } from '@polar-sh/sdk/2026-04';
import { PolarClientError, PolarRateLimitError, PolarServerError } from '@polar-sh/sdk';
import type { catalogPolarConfig } from './polar-config.js';

export type DesiredProduct = {
  title: string;
  description: string;
  unitAmount: number;
  currency: 'pen';
  archived: boolean;
};
export interface ProductGateway {
  prepare(): Promise<void>;
  find(productId: string): Promise<string | null>;
  create(productId: string, desired: DesiredProduct): Promise<string>;
  update(polarProductId: string, desired: DesiredProduct): Promise<void>;
}
type Operation =
  | 'organizations.list'
  | 'organizations.update'
  | 'products.find'
  | 'products.create'
  | 'products.get'
  | 'products.update';
export class ProductSyncError extends Error {
  constructor(
    code: string,
    readonly operation?: Operation,
    readonly httpStatus?: number,
  ) {
    super(code);
  }
}
export class ProductSyncRejected extends ProductSyncError {}
export class ProductSyncRetryable extends ProductSyncError {
  retryAfter?: number;
}
export class ProductSyncUncertain extends ProductSyncRetryable {}

export function createProductGateway(
  config: NonNullable<ReturnType<typeof catalogPolarConfig>>,
): ProductGateway {
  const polar = createPolar({
    accessToken: config.accessToken,
    environment: config.server,
    timeout: 5,
  });
  let organizationId: string | undefined;
  const name = (title: string) =>
    Array.from(Array.from(title).length < 3 ? `${title} MercadoYa` : title)
      .slice(0, 64)
      .join('');
  function prices(desired: DesiredProduct) {
    if (
      !Number.isSafeInteger(desired.unitAmount) ||
      desired.unitAmount < 200 ||
      desired.unitAmount > 99_999_999
    )
      throw new ProductSyncRejected('polar_amount_invalid');
    return [
      {
        amount_type: 'fixed' as const,
        price_currency: 'pen' as const,
        price_amount: desired.unitAmount,
        tax_behavior: 'exclusive' as const,
      },
    ];
  }
  async function request<T>(
    operation: Operation,
    run: () => Promise<T>,
    creating = false,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ProductSyncError) throw error;
      if (error instanceof PolarClientError && error.statusCode === 429) {
        const limited = new ProductSyncRetryable('polar_rate_limited', operation, 429);
        if (error instanceof PolarRateLimitError && error.retryAfter !== null)
          limited.retryAfter = error.retryAfter;
        throw limited;
      }
      if (error instanceof PolarClientError && error.statusCode !== 408) {
        const code =
          error.statusCode === 401
            ? 'polar_token_invalid'
            : error.statusCode === 403
              ? 'polar_permission_denied'
              : error.statusCode === 422
                ? 'polar_validation_rejected'
                : 'polar_product_rejected';
        throw new ProductSyncRejected(code, operation, error.statusCode);
      }
      // Nunca propagar mensajes ni cuerpos del SDK: pueden contener credenciales.
      const serverStatus =
        error instanceof PolarServerError
          ? /^Polar API returned a server error: (5\d{2}) - /.exec(error.message)?.[1]
          : undefined;
      const status =
        error instanceof PolarClientError
          ? error.statusCode
          : serverStatus
            ? Number(serverStatus)
            : undefined;
      if (creating) throw new ProductSyncUncertain('polar_product_uncertain', operation, status);
      throw new ProductSyncRetryable('polar_product_retry', operation, status);
    }
  }
  return {
    async prepare() {
      if (organizationId) return;
      const organizations = await request('organizations.list', () =>
        polar.organizations.list({ limit: 2 }),
      );
      if (organizations.items.length !== 1 || organizations.pagination.total_count !== 1)
        throw new ProductSyncRejected('polar_organization_token_required', 'organizations.list');
      const organization = organizations.items[0]!;
      if (organization.default_presentment_currency !== 'pen') {
        const updated = await request('organizations.update', () =>
          polar.organizations.update(organization.id, {
            default_presentment_currency: 'pen',
          }),
        );
        if (updated.default_presentment_currency !== 'pen')
          throw new ProductSyncRejected('polar_currency_not_updated', 'organizations.update');
      }
      organizationId = organization.id;
    },
    async find(productId) {
      return request('products.find', async () => {
        let found: string | null = null;
        for await (const product of polar.products.iterList({
          organization_id: organizationId,
          metadata: { mercadoya_product_id: productId },
          limit: 100,
        })) {
          if (product.metadata.mercadoya_product_id !== productId) continue;
          if (product.is_recurring) throw new ProductSyncRejected('polar_product_not_one_time');
          if (found) throw new ProductSyncRejected('polar_product_duplicate');
          found = product.id;
        }
        return found;
      });
    },
    async create(productId, desired) {
      const productPrices = prices(desired);
      return request(
        'products.create',
        async () => {
          const product = await polar.products.create({
            // Un OAT ya identifica la organización. Polar rechaza organization_id en el body.
            name: name(desired.title),
            description: desired.description,
            recurring_interval: null,
            prices: productPrices,
            metadata: { mercadoya_product_id: productId },
          });
          return product.id;
        },
        true,
      );
    },
    async update(polarProductId, desired) {
      if (desired.archived) {
        await request('products.update', async () => {
          await polar.products.update(polarProductId, { is_archived: true });
        });
        return;
      }
      const productPrices = prices(desired);
      const current = await request('products.get', () => polar.products.get(polarProductId));
      await request('products.update', async () => {
        const active = current.prices.filter((price) => !price.is_archived);
        const samePrice =
          active.length === 1 &&
          active[0]!.amount_type === 'fixed' &&
          active[0]!.price_currency === 'pen' &&
          active[0]!.tax_behavior === 'exclusive' &&
          'price_amount' in active[0]! &&
          active[0]!.price_amount === desired.unitAmount;
        await polar.products.update(polarProductId, {
          name: name(desired.title),
          description: desired.description,
          is_archived: false,
          ...(samePrice ? {} : { prices: productPrices }),
        });
      });
    },
  };
}
