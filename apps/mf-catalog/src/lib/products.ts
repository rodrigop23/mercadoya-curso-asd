import { queryOptions } from '@tanstack/react-query';

export function createCatalogApi(apiBaseUrl: string) {
  const API_BASE_URL = apiBaseUrl.replace(/\/$/, '');

  function productImageUrl(imagePath: string) {
    const encodedPath = imagePath.split('/').map(encodeURIComponent).join('/');
    return `${API_BASE_URL}/uploads/${encodedPath}`;
  }

  const productsQueryOptions = queryOptions({
    queryKey: ['admin-products', API_BASE_URL],
    queryFn: async (): Promise<Product[]> => {
      const response = await fetch(`${API_BASE_URL}/api/products`);

      if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo. Inténtalo de nuevo.');
      }

      const data = (await response.json()) as { products: Product[] };
      return data.products;
    },
  });

  async function createProduct(formData: FormData): Promise<Product> {
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

  async function updateProduct({
    id,
    formData,
  }: {
    id: string;
    formData: FormData;
  }): Promise<Product> {
    const response = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? 'No se pudo actualizar el producto. Inténtalo de nuevo.');
    }
    const data = (await response.json()) as { product: Product };
    return data.product;
  }

  async function deleteProduct(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? 'No se pudo eliminar el producto. Inténtalo de nuevo.');
    }
  }

  return { productImageUrl, productsQueryOptions, createProduct, updateProduct, deleteProduct };
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
