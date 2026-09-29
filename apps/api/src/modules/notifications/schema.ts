import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// This table reserves a module-owned namespace. No delivery runs in this stub.
export const notificationMessage = pgTable('notifications_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
