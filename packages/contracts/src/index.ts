import { z } from 'zod';

export const eventSubjects = {
  ordersPlaced: 'orders.placed',
  inventoryReserved: 'inventory.reserved',
  inventoryRejected: 'inventory.rejected',
} as const;

export type EventSubject = (typeof eventSubjects)[keyof typeof eventSubjects];

export const orderPlacedEventSchema = z.object({
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

export type OrderPlacedEvent = z.infer<typeof orderPlacedEventSchema>;

const inventoryReservationResult = {
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
};

export const inventoryReservedEventSchema = z.object(inventoryReservationResult);
export const inventoryRejectedEventSchema = z.object({
  ...inventoryReservationResult,
  reason: z.enum(['invalid_quantity', 'product_not_found', 'insufficient_stock', 'stock_limit']),
});

export type InventoryReservedEvent = z.infer<typeof inventoryReservedEventSchema>;
export type InventoryRejectedEvent = z.infer<typeof inventoryRejectedEventSchema>;

export type ReservationReason =
  | 'invalid_quantity'
  | 'product_not_found'
  | 'insufficient_stock'
  | 'stock_limit';

export type ReservationResult = { reserved: true } | { reserved: false; reason: ReservationReason };

export interface InventoryPort {
  reserve(input: {
    orderId: string;
    productId: string;
    quantity: number;
  }): Promise<ReservationResult>;
}

export type StockAdjustmentResult =
  | { adjusted: true; availableStock: number }
  | { adjusted: false; reason: 'product_not_found' | 'insufficient_stock' | 'stock_limit' };

export interface CatalogStockContract {
  getAvailableStock(productId: string): Promise<number | null>;
  adjustStock(productId: string, delta: number): Promise<StockAdjustmentResult>;
}
