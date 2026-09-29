import { queryOptions } from '@tanstack/react-query';

export const API_BASE_URL = 'http://localhost:3001';

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

export async function createProduct(formData: FormData): Promise<Product> {
  const response = await fetch(`${API_BASE_URL}/api/products`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'No se pudo crear el producto. Inténtalo de nuevo.');
  }

  const data = (await response.json()) as { product: Product };
  return data.product;
}
