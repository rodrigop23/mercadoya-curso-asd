import { createCatalogRoutes } from './routes.js';
import type { IdentityContract } from '../identity/contract.js';
import { catalogContract } from './service.js';

export { type CatalogContract, type CatalogProduct, type CreateProductInput } from './contract.js';

export function createCatalogModule(identity: IdentityContract) {
  return {
    contract: catalogContract,
    routes: createCatalogRoutes(identity),
  };
}
