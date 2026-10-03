import { and, desc, eq } from 'drizzle-orm';
import {
  eventSubjects,
  orderPlacedEventSchema,
  type CreateOrderRequest,
  type CartItem,
} from '@mercadoya/contracts';

import { db } from '../db/index.js';
import type { EventBus } from '../events/event-bus.js';
import { orderRecord, type OrderStatus } from './schema.js';
import type { CatalogBillingPort } from '../catalog/http.js';
import { CatalogBillingError } from '../catalog/http.js';

export type CreateOrderInput = CreateOrderRequest & { buyerId: string | null };

function publicOrder(row: typeof orderRecord.$inferSelect) {
  const { paymentProduct, items, ...order } = row;
  return {
    ...order,
    items:
      items?.map(({ polarProductId, ...item }) => {
        void polarProductId;
        return item;
      }) ?? null,
    totalAmount: items
      ? items.reduce((total, item) => total + item.unitAmount * item.quantity, 0)
      : paymentProduct
        ? paymentProduct.unitAmount * row.quantity
        : null,
    currency: items || paymentProduct ? ('pen' as const) : null,
  };
}

function sameItems(a: CartItem[], b: CartItem[]) {
  const key = (items: CartItem[]) =>
    JSON.stringify(items.map((item) => [item.productId, item.quantity]).sort());
  return key(a) === key(b);
}

export function createOrdersService(eventBus: EventBus, catalog: CatalogBillingPort) {
  return {
    async createOrder(input: CreateOrderInput) {
      const lines =
        'items' in input ? input.items : [{ productId: input.productId, quantity: input.quantity }];
      const readExisting = async () => {
        if (!input.idempotencyKey) return null;
        const [existing] = await db
          .select()
          .from(orderRecord)
          .where(eq(orderRecord.id, input.idempotencyKey));
        if (!existing) return null;
        if (
          existing.buyerId !== input.buyerId ||
          !sameItems(
            existing.items ?? [{ productId: existing.productId, quantity: existing.quantity }],
            lines,
          )
        )
          throw new CatalogBillingError(409, 'Este intento de pago ya corresponde a otro pedido.');
        return { order: publicOrder(existing) };
      };
      const existing = await readExisting();
      if (existing) return existing;
      const snapshots = await Promise.all(
        lines.map(async (item) => {
          const product = await catalog.getBillingProduct(item.productId);
          return {
            ...product,
            quantity: item.quantity,
            title: product.title ?? 'Producto',
            thumbnailPath: product.thumbnailPath ?? null,
          };
        }),
      );
      const paymentProduct = snapshots[0]!;
      const total = snapshots.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
      if (!Number.isSafeInteger(total) || total > 99_999_999)
        throw new CatalogBillingError(409, 'El importe del pedido supera el máximo permitido.');
      const [createdOrder] = await db
        .insert(orderRecord)
        .values({
          ...(input.idempotencyKey ? { id: input.idempotencyKey } : {}),
          productId: paymentProduct.productId,
          quantity: paymentProduct.quantity,
          buyerId: input.buyerId,
          paymentProduct,
          items: 'items' in input ? snapshots : null,
          status: 'pending',
        })
        .onConflictDoNothing()
        .returning();

      if (!createdOrder) {
        const concurrent = await readExisting();
        if (concurrent) return concurrent;
        throw new Error('No se pudo guardar el pedido.');
      }

      // La saga mantiene pending hasta el resultado de Payment o el rechazo de Inventory.
      const event = orderPlacedEventSchema.parse({
        version: 1,
        orderId: createdOrder.id,
        productId: paymentProduct.productId,
        quantity: paymentProduct.quantity,
        ...('items' in input ? { items: lines } : {}),
        buyerId: input.buyerId,
        occurredAt: new Date().toISOString(),
      });
      await eventBus.publish(eventSubjects.ordersPlaced, event);

      return { order: publicOrder(createdOrder) };
    },

    async listOrders(buyerId: string) {
      const orders = await db
        .select()
        .from(orderRecord)
        .where(eq(orderRecord.buyerId, buyerId))
        .orderBy(desc(orderRecord.createdAt), desc(orderRecord.id));

      return orders.map(publicOrder);
    },

    async getOrder(orderId: string) {
      const [order] = await db
        .select()
        .from(orderRecord)
        .where(eq(orderRecord.id, orderId))
        .limit(1);

      return order ? publicOrder(order) : null;
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

      return order ? publicOrder(order) : null;
    },
  };
}
