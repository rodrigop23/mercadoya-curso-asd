// The shared Drizzle client composes module-owned tables here. Runtime queries
// remain inside the module that owns each table.
export * from '../modules/identity/schema.js';
export * from '../modules/catalog/schema.js';
export * from '../modules/media/schema.js';
// Keep this table in API migrations while Orders runs in its own process.
export * from './orders-schema.js';
// API migrations still own Inventory's table while the service runs separately.
export * from './inventory-schema.js';
export * from '../modules/notifications/schema.js';
