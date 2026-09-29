import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Optional metadata for locally stored media assets.
export const mediaAsset = pgTable('media_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  storageKey: text('storage_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
