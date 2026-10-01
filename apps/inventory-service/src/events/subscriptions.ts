import { eventSubjects } from '@mercadoya/contracts';
import type { EventBus } from './event-bus.js';

export async function subscribeInventoryEvents(
  eventBus: EventBus,
  handlers: {
    onOrderPlaced(payload: unknown): Promise<void>;
    onPaymentFailed(payload: unknown): Promise<void>;
  },
) {
  await eventBus.subscribe(eventSubjects.ordersPlaced, 'inventory.reserve', handlers.onOrderPlaced);
  await eventBus.subscribe(
    eventSubjects.paymentFailed,
    'inventory.release',
    handlers.onPaymentFailed,
  );
}
