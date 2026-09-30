import { stockResponseSchema, stockAdjustmentResponseSchema } from '@mercadoya/contracts';
import type { CatalogStockContract } from '@mercadoya/contracts';

export function createCatalogHttpClient(): CatalogStockContract {
  const origin = process.env.CATALOG_URL || 'http://localhost:3001';
  const token = process.env.CATALOG_INTERNAL_TOKEN || '';
  if (!token) throw new Error('CATALOG_INTERNAL_TOKEN is required.');

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(new URL(path, origin), {
      ...init,
      headers: {
        'x-catalog-internal-token': token,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}: ${path}`);
    return response.json();
  }

  return {
    async getAvailableStock(productId) {
      const result = stockResponseSchema.parse(
        await request(`/api/internal/catalog/products/${encodeURIComponent(productId)}/stock`),
      );
      return result.availableStock;
    },
    async adjustStock(productId, delta) {
      return stockAdjustmentResponseSchema.parse(
        await request(
          `/api/internal/catalog/products/${encodeURIComponent(productId)}/adjust-stock`,
          {
            method: 'POST',
            body: JSON.stringify({ delta }),
          },
        ),
      );
    },
  };
}
