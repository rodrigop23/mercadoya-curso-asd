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
