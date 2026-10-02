import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Historical table kept for existing migrations. The Lambda handler logs notification results without writing this table.
export const notificationMessage = pgTable('notifications_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
