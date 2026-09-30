import { eventSubjects } from '@mercadoya/contracts';
import type { EventBus } from './event-bus.js';

export async function subscribeInventoryEvents(
  eventBus: EventBus,
  handlers: {
    onOrderPlaced(payload: unknown): Promise<void>;
    onPaymentFailed(payload: unknown): Promise<void>;
  },
  serviceVersion: 'v1' | 'v2',
) {
  if (serviceVersion !== 'v2') return;
  await eventBus.subscribe(eventSubjects.ordersPlaced, 'inventory.reserve', handlers.onOrderPlaced);
  await eventBus.subscribe(
    eventSubjects.paymentFailed,
    'inventory.release',
    handlers.onPaymentFailed,
  );
}
