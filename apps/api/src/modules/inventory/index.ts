import { createInventoryRoutes } from './routes.js';

export type { InventoryPort, ReservationResult } from './ports.js';

export function createInventoryModule() {
  return { routes: createInventoryRoutes() };
}
