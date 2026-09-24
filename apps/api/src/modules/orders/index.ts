import { createOrdersRoutes } from './routes.js';

export type { InventoryReservationPort } from './ports.js';

export function createOrdersModule() {
  return { routes: createOrdersRoutes() };
}
