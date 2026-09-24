import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import type { InventoryReservationPort } from './ports.js';
import { orderRecord, type OrderStatus } from './schema.js';

export type CreateOrderInput = {
  productId: string;
  quantity: number;
  buyerId: string | null;
};

export function createOrdersService(inventory: InventoryReservationPort) {
  return {
    async createOrder(input: CreateOrderInput) {
      const [createdOrder] = await db
        .insert(orderRecord)
        .values({
          productId: input.productId,
          quantity: input.quantity,
          buyerId: input.buyerId,
          status: 'pending',
        })
        .returning();

      if (!createdOrder) {
        throw new Error('No se pudo guardar el pedido.');
      }

      // Orders invokes Inventory through the sync port until prompt 05 replaces it with events.
      const reservation = await inventory.reserve({
        orderId: createdOrder.id,
        productId: input.productId,
        quantity: input.quantity,
      });
      const status: OrderStatus = reservation.reserved ? 'confirmed' : 'rejected';
      const [order] = await db
        .update(orderRecord)
        .set({
          status,
          rejectionReason: reservation.reserved ? null : reservation.reason,
          updatedAt: new Date(),
        })
        .where(eq(orderRecord.id, createdOrder.id))
        .returning();

      if (!order) {
        throw new Error('No se pudo actualizar el estado del pedido.');
      }

      return { order, reservation };
    },
  };
}
