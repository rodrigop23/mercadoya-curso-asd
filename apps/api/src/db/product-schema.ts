import { pgTable, integer, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const product = pgTable('product', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  price: numeric('price', { precision: 10, scale: 2, mode: 'number' }).notNull(),
  stock: integer('stock').notNull(),
  imagePath: text('image_path').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
