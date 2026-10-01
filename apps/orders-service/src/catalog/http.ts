import { catalogBillingResponseSchema, type BillingProduct } from '@mercadoya/contracts';

export interface CatalogBillingPort {
  getBillingProduct(productId: string): Promise<BillingProduct>;
}
export class CatalogBillingError extends Error {
  constructor(
    public readonly status: 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

export function createCatalogBillingClient(): CatalogBillingPort {
  const origin = process.env.CATALOG_URL || 'http://localhost:3007';
  const token = process.env.CATALOG_INTERNAL_TOKEN;
  if (!token) throw new Error('Configura CATALOG_INTERNAL_TOKEN en Orders.');
  return {
    async getBillingProduct(productId) {
      try {
        const response = await fetch(
          new URL(
            `/api/internal/catalog/products/${encodeURIComponent(productId)}/billing`,
            origin,
          ),
          {
            headers: { 'x-catalog-internal-token': token },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (response.status === 404) throw new CatalogBillingError(404, 'Producto no encontrado.');
        if (![200, 202, 409].includes(response.status)) throw new Error('catalog_unavailable');
        const result = catalogBillingResponseSchema.parse(await response.json());
        if (result.status !== 'ready')
          throw new CatalogBillingError(
            409,
            result.status === 'pending'
              ? 'Estamos preparando los pagos de este producto. Intenta de nuevo en unos segundos.'
              : 'Los pagos de este producto no están disponibles. Intenta más tarde.',
          );
        if (result.product.productId !== productId) throw new Error('catalog_product_mismatch');
        return result.product;
      } catch (error) {
        if (error instanceof CatalogBillingError) throw error;
        throw new CatalogBillingError(
          503,
          'No se pudo consultar el precio del producto. Intenta de nuevo.',
        );
      }
    },
  };
}
