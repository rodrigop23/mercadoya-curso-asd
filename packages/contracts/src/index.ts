import { z } from 'zod';
import {
  cartItemsSchema,
  type CartItem,
  type StockBatchRequest,
  type StockBatchResponse,
} from './http.js';

export const eventSubjects = {
  ordersPlaced: 'orders.placed',
  inventoryReserved: 'inventory.reserved',
  inventoryRejected: 'inventory.rejected',
  inventoryReleased: 'inventory.released',
  paymentSucceeded: 'payment.succeeded',
  paymentFailed: 'payment.failed',
} as const;

export type EventSubject = (typeof eventSubjects)[keyof typeof eventSubjects];

export const orderPlacedEventSchema = z.object({
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  items: cartItemsSchema.optional(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

export type OrderPlacedEvent = z.infer<typeof orderPlacedEventSchema>;

// Campos aditivos v1: los consumidores antiguos pueden descartarlos.
const paymentCorrelation = {
  provider: z.literal('polar').optional(),
  eventId: z.string().min(1).max(200).optional(),
  checkoutId: z.string().uuid().optional(),
  providerOrderId: z.string().uuid().optional(),
};
const inventoryReservationResult = {
  version: z.literal(1),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  items: cartItemsSchema.optional(),
  buyerId: z.string().nullable(),
  occurredAt: z.string().datetime(),
};

export const inventoryReservedEventSchema = z.object({
  ...inventoryReservationResult,
});
export const inventoryReleasedEventSchema = z.object({
  ...inventoryReservationResult,
  ...paymentCorrelation,
});
export const paymentSucceededEventSchema = z.object({
  ...inventoryReservationResult,
  ...paymentCorrelation,
});
export const paymentFailedEventSchema = z.object({
  ...inventoryReservationResult,
  ...paymentCorrelation,
  reason: z.string().min(1).max(160),
});
export type InventoryReleasedEvent = z.infer<typeof inventoryReleasedEventSchema>;
export type PaymentSucceededEvent = z.infer<typeof paymentSucceededEventSchema>;
export type PaymentFailedEvent = z.infer<typeof paymentFailedEventSchema>;
export const inventoryRejectedEventSchema = z.object({
  ...inventoryReservationResult,
  reason: z.enum(['invalid_quantity', 'product_not_found', 'insufficient_stock', 'stock_limit']),
});

export type InventoryReservedEvent = z.infer<typeof inventoryReservedEventSchema>;
export type InventoryRejectedEvent = z.infer<typeof inventoryRejectedEventSchema>;

const reservationHttpSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int(),
  createdAt: z.string().datetime(),
});

export const reservationResponseSchema = z.object({
  reservation: reservationHttpSchema.extend({ status: z.literal('reserved') }),
});

export type ReservationResponse = z.infer<typeof reservationResponseSchema>;

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
    items?: CartItem[];
  }): Promise<ReservationResult>;
}

export type StockAdjustmentResult = import('./http.js').StockAdjustmentResponse;

export interface CatalogStockContract {
  getAvailableStock(productId: string): Promise<number | null>;
  adjustStock(productId: string, delta: number): Promise<StockAdjustmentResult>;
  adjustStockBatch(input: StockBatchRequest): Promise<StockBatchResponse>;
}

export * from './http.js';
