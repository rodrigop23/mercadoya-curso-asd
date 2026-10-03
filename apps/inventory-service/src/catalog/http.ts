import {
  stockResponseSchema,
  stockAdjustmentResponseSchema,
  stockBatchResponseSchema,
} from '@mercadoya/contracts';
import type { CatalogStockContract } from '@mercadoya/contracts';

class CatalogHttpError extends Error {
  constructor(
    public readonly status: number,
    path: string,
  ) {
    super(`Catalog HTTP ${status}: ${path}`);
  }
}

export function createCatalogHttpClient(): CatalogStockContract {
  const origin = process.env.CATALOG_URL || 'http://localhost:3007';
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
    if (!response.ok) throw new CatalogHttpError(response.status, path);
    return response.json();
  }

  return {
    async adjustStockBatch(input) {
      // La clave permite reintentar incluso si Catalog confirmó el ajuste y se perdió la respuesta.
      for (let attempt = 0; ; attempt++) {
        try {
          return stockBatchResponseSchema.parse(
            await request('/api/internal/catalog/stock/adjust-batch', {
              method: 'POST',
              body: JSON.stringify(input),
            }),
          );
        } catch (error) {
          if (attempt === 2 || (error instanceof CatalogHttpError && error.status < 500))
            throw error;
        }
      }
    },
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
