export interface InventoryReservationPort {
  reserve(input: {
    orderId: string;
    productId: string;
    quantity: number;
  }): Promise<{ reserved: boolean }>;
}
