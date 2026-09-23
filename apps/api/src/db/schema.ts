// The shared Drizzle client composes module-owned tables here. Runtime queries
// remain inside the module that owns each table.
export * from '../modules/identity/schema.js';
export * from '../modules/catalog/schema.js';
