import { and, eq } from 'drizzle-orm';
import { eventSubjects, orderPlacedEventSchema } from '@mercadoya/contracts';

import { db } from '../db/index.js';
import type { EventBus } from '../events/event-bus.js';
import { orderRecord, type OrderStatus } from './schema.js';

export type CreateOrderInput = {
  productId: string;
  quantity: number;
  buyerId: string | null;
  paymentMode?: 'succeed' | 'fail';
};

export function createOrdersService(eventBus: EventBus) {
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

      // La saga mantiene pending hasta el resultado de Payment o el rechazo de Inventory.
      const event = orderPlacedEventSchema.parse({
        version: 1,
        paymentMode: input.paymentMode,
        orderId: createdOrder.id,
        productId: input.productId,
        quantity: input.quantity,
        buyerId: input.buyerId,
        occurredAt: new Date().toISOString(),
      });
      await eventBus.publish(eventSubjects.ordersPlaced, event);

      return { order: createdOrder };
    },

    async getOrder(orderId: string) {
      const [order] = await db
        .select()
        .from(orderRecord)
        .where(eq(orderRecord.id, orderId))
        .limit(1);

      return order ?? null;
    },

    async recordSagaResult(input: {
      orderId: string;
      status: Extract<OrderStatus, 'confirmed' | 'rejected'>;
      rejectionReason: string | null;
    }) {
      const [order] = await db
        .update(orderRecord)
        .set({
          status: input.status,
          rejectionReason: input.rejectionReason,
          updatedAt: new Date(),
        })
        .where(and(eq(orderRecord.id, input.orderId), eq(orderRecord.status, 'pending')))
        .returning();

      return order ?? null;
    },
  };
}
