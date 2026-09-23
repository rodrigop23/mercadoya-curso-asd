import { auth } from './auth.js';
import type { AdminAuthorization, IdentityContract } from './contract.js';

export const identityContract: IdentityContract = {
  async getSession(headers) {
    return auth.api.getSession({ headers });
  },

  async requireAdmin(headers): Promise<AdminAuthorization> {
    const session = await identityContract.getSession(headers);

    if (!session) {
      return { allowed: false, status: 401 };
    }

    if (session.user.role !== 'admin') {
      return { allowed: false, status: 403 };
    }

    return { allowed: true };
  },
};
