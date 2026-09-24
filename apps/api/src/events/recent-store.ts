import { randomUUID } from 'node:crypto';

export type RecentEvent = {
  id: string;
  timestamp: string;
  type: string;
  [key: string]: unknown;
};

type RecentEventsFilter = {
  limit?: number;
  orderId?: string;
};

export const MAX_RECENT_EVENTS = 100;

const buffer: Array<RecentEvent | undefined> = new Array(MAX_RECENT_EVENTS);
let nextIndex = 0;
let eventCount = 0;

export function appendRecentEvent(entry: Record<string, unknown>): RecentEvent {
  const event: RecentEvent = {
    ...entry,
    id: randomUUID(),
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
    type: typeof entry.type === 'string' ? entry.type : 'unknown',
  };

  buffer[nextIndex] = event;
  nextIndex = (nextIndex + 1) % MAX_RECENT_EVENTS;
  eventCount = Math.min(eventCount + 1, MAX_RECENT_EVENTS);

  return event;
}

export function getRecentEvents({ limit = 50, orderId }: RecentEventsFilter = {}): RecentEvent[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_RECENT_EVENTS, Math.floor(limit)))
    : 50;
  const firstIndex = (nextIndex - eventCount + MAX_RECENT_EVENTS) % MAX_RECENT_EVENTS;
  const matchingEvents: RecentEvent[] = [];

  for (let offset = 0; offset < eventCount; offset += 1) {
    const event = buffer[(firstIndex + offset) % MAX_RECENT_EVENTS];
    if (!event || (orderId && event.orderId !== orderId)) {
      continue;
    }

    matchingEvents.push(event);
  }

  // Keep the latest matches and return the newest event first.
  return matchingEvents.slice(-safeLimit).reverse();
}
