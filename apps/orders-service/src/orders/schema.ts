import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { BillingProduct, BillingOrderItem } from '@mercadoya/contracts';

export type OrderStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'expired';

export const orderRecord = pgTable('orders_order', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull(),
  buyerId: text('buyer_id'),
  paymentProduct: jsonb('payment_product').$type<BillingProduct>(),
  items: jsonb('items').$type<BillingOrderItem[]>(),
  status: text('status').$type<OrderStatus>().notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
