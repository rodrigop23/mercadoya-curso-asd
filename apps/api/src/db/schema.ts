// Drizzle's shared connection sees the tables owned by each module. Runtime
// queries remain inside the module that owns the table.
export * from '../modules/identity/schema.js';
export * from '../modules/catalog/schema.js';
