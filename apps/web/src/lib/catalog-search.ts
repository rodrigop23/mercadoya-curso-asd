import { productsQuerySchema, type ProductsQuery } from '@mercadoya/contracts';
import { z } from 'zod';

// Router convierte los números de la URL antes de ejecutar validateSearch.
const numericPriceSchema = z.number().finite().nonnegative().multipleOf(0.01);

export function parseCatalogSearch(raw: Record<string, unknown>): ProductsQuery {
  const rawQuery = typeof raw.q === 'number' && Number.isFinite(raw.q) ? String(raw.q) : raw.q;
  const q = productsQuerySchema.shape.q.safeParse(rawQuery);
  const minPrice = parsePrice(raw.minPrice);
  const maxPrice = parsePrice(raw.maxPrice);
  const validRange = minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice;

  return {
    ...(q.success && q.data !== undefined ? { q: q.data } : {}),
    ...(validRange && minPrice !== undefined ? { minPrice } : {}),
    ...(validRange && maxPrice !== undefined ? { maxPrice } : {}),
  };
}

function parsePrice(raw: unknown): number | undefined {
  const result =
    typeof raw === 'number'
      ? numericPriceSchema.safeParse(raw)
      : productsQuerySchema.shape.minPrice.safeParse(raw);
  return result.success ? result.data : undefined;
}
