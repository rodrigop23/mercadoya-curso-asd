import { createCatalogRoutes } from './routes.js';
import type { IdentityContract } from '../identity/contract.js';
import type { MediaContract } from '../media/contract.js';
import { createCatalogContract } from './service.js';

export { type CatalogContract, type CatalogProduct, type CreateProductInput } from './contract.js';

export function createCatalogModule(identity: IdentityContract, media: MediaContract) {
  const contract = createCatalogContract(media);

  return {
    contract,
    routes: createCatalogRoutes(identity, contract),
  };
}
