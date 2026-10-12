import {
  pgTable,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
  primaryKey,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { DesiredProduct } from './polar-gateway.js';
import type { StockBatchRequest } from '@mercadoya/contracts';

export const stockOperation = pgTable('catalog_stock_operation', {
  id: text('id').primaryKey(),
  adjustments: jsonb('adjustments').$type<StockBatchRequest['adjustments']>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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

export const polarProduct = pgTable(
  'catalog_polar_product',
  {
    productId: uuid('product_id').notNull(),
    server: text('server').notNull(),
    desired: jsonb('desired').$type<DesiredProduct>().notNull(),
    version: integer('version').notNull().default(1),
    syncedVersion: integer('synced_version').notNull().default(0),
    state: text('state').notNull().default('queued'),
    polarProductId: uuid('polar_product_id'),
    errorCode: text('error_code'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.server] }),
    unique().on(table.server, table.polarProductId),
    index('catalog_polar_product_pending')
      .on(table.nextAttemptAt)
      .where(sql`${table.state} <> 'synced'`),
    check('catalog_polar_product_server', sql`${table.server} IN ('sandbox', 'production')`),
    check(
      'catalog_polar_product_state',
      sql`${table.state} IN ('queued', 'creating', 'synced', 'error')`,
    ),
  ],
);
