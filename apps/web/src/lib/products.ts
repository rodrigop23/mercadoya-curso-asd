import { queryOptions } from '@tanstack/react-query';
import type { ProductsQuery } from '@mercadoya/contracts';

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export function productImageUrl(imagePath: string) {
  const encodedPath = imagePath.split('/').map(encodeURIComponent).join('/');
  return `${API_BASE_URL}/uploads/${encodedPath}`;
}

export function productThumbnailPath(imagePath: string): string | null {
  if (/-thumb\.[^.]+$/.test(imagePath)) return imagePath;
  return /-full\.[^.]+$/.test(imagePath) ? imagePath.replace(/-full\.([^.]+)$/, '-thumb.$1') : null;
}

export const priceFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
});

export type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  stock: number;
  imagePath: string;
  createdAt: string;
  updatedAt: string;
};

export function productsQueryOptions(filters: ProductsQuery = {}) {
  return queryOptions({
    queryKey: ['products', filters],
    queryFn: async ({ signal }): Promise<Product[]> => {
      const params = new URLSearchParams();
      if (filters.q?.trim()) params.set('q', filters.q.trim());
      if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
      if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
      const query = params.toString();
      const response = await fetch(`${API_BASE_URL}/api/products${query ? `?${query}` : ''}`, {
        signal,
      });

      if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo. Inténtalo de nuevo.');
      }

      const data = (await response.json()) as { products: Product[] };
      return data.products;
    },
  });
}
