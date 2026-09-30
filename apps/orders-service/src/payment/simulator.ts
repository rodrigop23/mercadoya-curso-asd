import {
  eventSubjects,
  inventoryReservedEventSchema,
  paymentModeSchema,
  paymentSucceededEventSchema,
  paymentFailedEventSchema,
} from '@mercadoya/contracts';
import type { EventBus } from '../events/event-bus.js';

// Paso didáctico alojado en Orders. No coordina la saga ni integra un PSP.
export async function subscribePaymentSimulator(eventBus: EventBus) {
  const mode = paymentModeSchema.parse(process.env.PAYMENT_MODE || 'succeed');
  await eventBus.subscribe(eventSubjects.inventoryReserved, 'payment.simulate', async (payload) => {
    const event = inventoryReservedEventSchema.parse(payload);
    const payment = { ...event, occurredAt: new Date().toISOString() };
    if ((event.paymentMode ?? mode) === 'fail') {
      await eventBus.publish(
        eventSubjects.paymentFailed,
        paymentFailedEventSchema.parse({
          ...payment,
          reason: 'simulated_payment_failure',
        }),
      );
    } else {
      await eventBus.publish(
        eventSubjects.paymentSucceeded,
        paymentSucceededEventSchema.parse(payment),
      );
    }
  });
}
