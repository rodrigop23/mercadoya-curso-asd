// The shared Drizzle client composes module-owned tables here. Runtime queries
// remain inside the module that owns each table.
export * from '../modules/identity/schema.js';
export * from '../modules/catalog/schema.js';
export * from '../modules/media/schema.js';
export * from '../modules/orders/schema.js';
export * from '../modules/inventory/schema.js';
export * from '../modules/notifications/schema.js';
