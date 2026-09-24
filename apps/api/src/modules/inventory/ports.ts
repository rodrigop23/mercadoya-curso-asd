export type ReservationResult = { reserved: true } | { reserved: false; reason: string };

export interface InventoryPort {
  reserve(input: {
    orderId: string;
    productId: string;
    quantity: number;
  }): Promise<ReservationResult>;
}
