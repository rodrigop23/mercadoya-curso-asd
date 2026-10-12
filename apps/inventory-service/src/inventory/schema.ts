import { integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { CartItem } from '@mercadoya/contracts';

export const inventoryReservation = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').notNull(),
    productId: uuid('product_id').notNull(),
    quantity: integer('quantity').notNull(),
    items: jsonb('items').$type<CartItem[]>(),
    releasedAt: timestamp('released_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('inventory_reservations_order_id_unique').on(table.orderId)],
);
