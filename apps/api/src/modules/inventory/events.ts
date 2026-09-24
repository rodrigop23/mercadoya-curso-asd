import { z } from 'zod';
import { eventSubjects } from '../../events/subjects.js';

const inventoryReservationResult = {
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
};

export const inventoryReservedSubject = eventSubjects.inventoryReserved;
export const inventoryRejectedSubject = eventSubjects.inventoryRejected;

export const inventoryReservedEventSchema = z.object(inventoryReservationResult);
export const inventoryRejectedEventSchema = z.object({
  ...inventoryReservationResult,
  reason: z.enum(['invalid_quantity', 'product_not_found', 'insufficient_stock', 'stock_limit']),
});

export type InventoryReservedEvent = z.infer<typeof inventoryReservedEventSchema>;
export type InventoryRejectedEvent = z.infer<typeof inventoryRejectedEventSchema>;
