import { createOrdersRoutes } from './routes.js';
import type { IdentityContract } from '../identity/contract.js';
import type { InventoryReservationPort } from './ports.js';

export type { InventoryReservationPort } from './ports.js';

export function createOrdersModule(
  inventory: InventoryReservationPort,
  identity: IdentityContract,
) {
  return { routes: createOrdersRoutes(inventory, identity) };
}
