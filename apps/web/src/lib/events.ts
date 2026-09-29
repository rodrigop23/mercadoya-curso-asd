import { queryOptions } from '@tanstack/react-query';

import { API_BASE_URL } from './products';

export type TimelineEvent = {
  id: string;
  timestamp: string;
  type: string;
  transport?: string;
  subject?: string;
  consumer?: string;
  orderId?: string;
  status?: string;
  outcome?: string;
  reason?: string;
  notificationSubject?: string;
  [key: string]: unknown;
};

type EventListResponse = { events: TimelineEvent[] };
type ApiErrorResponse = { error?: string };

export type ListEventsInput = {
  limit?: number;
  orderId?: string;
  signal?: AbortSignal;
};

export async function listEvents({ limit = 50, orderId, signal }: ListEventsInput = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (orderId) {
    params.set('orderId', orderId);
  }

  const response = await fetch(`${API_BASE_URL}/api/events?${params.toString()}`, {
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(data?.error ?? 'No se pudieron consultar los eventos.');
  }

  const data = (await response.json()) as EventListResponse;
  return data.events;
}

export function eventsQueryOptions(input: {
  limit?: number;
  orderId?: string;
  refetchInterval?: number | false;
}) {
  const { limit = 50, orderId, refetchInterval = false } = input;

  return queryOptions({
    queryKey: ['events', { limit, orderId: orderId ?? null }],
    queryFn: ({ signal }) => listEvents({ limit, orderId, signal }),
    refetchInterval,
  });
}
