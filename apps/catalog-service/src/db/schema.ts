// The shared Drizzle client composes module-owned tables here. Runtime queries
// remain inside the module that owns each table.
export * from '../modules/catalog/schema.js';
export * from '../modules/media/schema.js';
// Keep this table in historical baseline while Orders runs in its own process.
export * from './orders-schema.js';
// historical baseline still own Inventory's table while the service runs separately.
export * from './inventory-schema.js';
// Keep the historical stub table in historical baseline; Lambda does not write to it.
export * from './notifications-schema.js';
