import { appendRecentEvent } from './recent-store.js';

export function logEvent(entry: Record<string, unknown>) {
  const event = appendRecentEvent(entry);
  console.info(JSON.stringify(event));
}

export function logEventHandlerError(input: {
  subject: string;
  consumer: string;
  transport: string;
  orderId?: string;
  error: unknown;
}) {
  const event = appendRecentEvent({
    ...input,
    type: 'event.handler_error',
    error: input.error instanceof Error ? input.error.message : String(input.error),
  });

  console.error(JSON.stringify(event));
}
