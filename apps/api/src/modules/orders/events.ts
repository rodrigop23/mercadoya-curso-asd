import { z } from 'zod';
import { eventSubjects } from '../../events/subjects.js';

export const orderPlacedSubject = eventSubjects.ordersPlaced;

export const orderPlacedEventSchema = z.object({
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

export type OrderPlacedEvent = z.infer<typeof orderPlacedEventSchema>;
