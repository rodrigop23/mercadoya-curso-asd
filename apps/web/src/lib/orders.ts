import { queryOptions } from '@tanstack/react-query';

import { API_BASE_URL } from './products';

export type OrderStatus = 'pending' | 'confirmed' | 'rejected';

export type Order = {
  id: string;
  productId: string;
  quantity: number;
  buyerId: string | null;
  status: OrderStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type OrderResponse = { order: Order };
type ApiErrorResponse = { error?: string };

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as ApiErrorResponse | null;
  return new Error(data?.error ?? fallback);
}

export async function createOrder(input: { productId: string; quantity: number }) {
  const response = await fetch(`${API_BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });

  if (!response.ok) {
    throw await readApiError(response, 'No se pudo crear el pedido. Inténtalo de nuevo.');
  }

  const data = (await response.json()) as OrderResponse;
  return data.order;
}

export async function getOrder(orderId: string): Promise<Order> {
  const response = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await readApiError(response, 'No se pudo consultar el pedido.');
  }

  const data = (await response.json()) as OrderResponse;
  return data.order;
}

export function orderQueryOptions(orderId: string) {
  return queryOptions({
    queryKey: ['orders', orderId],
    queryFn: () => getOrder(orderId),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 750 : false),
  });
}
