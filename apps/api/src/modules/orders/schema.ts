import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export type OrderStatus = 'pending' | 'confirmed' | 'rejected';

export const orderRecord = pgTable('orders_order', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull(),
  buyerId: text('buyer_id'),
  status: text('status').$type<OrderStatus>().notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
