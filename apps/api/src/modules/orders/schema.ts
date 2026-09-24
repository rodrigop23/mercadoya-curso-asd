import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// This table defines ownership only. Order creation and state changes are out of scope.
export const orderRecord = pgTable('orders_order', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
