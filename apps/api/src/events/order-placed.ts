import { z } from 'zod';

// Consumer-side validation for the v1 event emitted by orders-service.
export const orderPlacedEventSchema = z.object({
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
