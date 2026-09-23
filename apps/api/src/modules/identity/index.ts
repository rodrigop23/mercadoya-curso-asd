import { createIdentityRoutes } from './routes.js';
import { identityContract } from './service.js';

export {
  type AdminAuthorization,
  type IdentityContract,
  type IdentitySession,
} from './contract.js';

export function createIdentityModule() {
  return {
    contract: identityContract,
    routes: createIdentityRoutes(identityContract),
  };
}
