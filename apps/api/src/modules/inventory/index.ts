import { createInventoryRoutes } from './routes.js';
import type { CatalogContract } from '../catalog/contract.js';
import { createInventoryContract } from './service.js';

export type { InventoryPort, ReservationResult } from './ports.js';

export function createInventoryModule(catalog: CatalogContract) {
  const contract = createInventoryContract(catalog);

  return { contract, routes: createInventoryRoutes() };
}
