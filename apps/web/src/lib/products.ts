import { queryOptions } from '@tanstack/react-query';

export const API_BASE_URL = 'http://localhost:8000';

export function productImageUrl(imagePath: string) {
  const encodedPath = imagePath.split('/').map(encodeURIComponent).join('/');
  return `${API_BASE_URL}/uploads/${encodedPath}`;
}

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

export const productsQueryOptions = queryOptions({
  queryKey: ['products'],
  queryFn: async (): Promise<Product[]> => {
    const response = await fetch(`${API_BASE_URL}/api/products`);

    if (!response.ok) {
      throw new Error('No se pudo cargar el catálogo. Inténtalo de nuevo.');
    }

    const data = (await response.json()) as { products: Product[] };
    return data.products;
  },
});
