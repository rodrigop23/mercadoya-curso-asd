import { createCatalogRoutes } from './routes.js';
import type { AdminAuthorizer } from '../../auth.js';
import type { MediaContract } from '../media/contract.js';
import { createCatalogContract } from './service.js';

export {
  type CatalogContract,
  type CatalogProduct,
  type CreateProductInput,
  type UpdateProductInput,
  type StockAdjustmentResult,
} from './contract.js';

export function createCatalogModule(identity: AdminAuthorizer, media: MediaContract) {
  const contract = createCatalogContract(media);

  return {
    contract,
    routes: createCatalogRoutes(identity, contract),
  };
}
