import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

// Reservation shape only. This module does not read or change stock yet.
export const inventoryReservation = pgTable('inventory_reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull(),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
