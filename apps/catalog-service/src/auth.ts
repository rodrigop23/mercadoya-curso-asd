import { createTokenVerifier } from '@mercadoya/jwt-verifier';

export type AdminAuthorizer = {
  requireAdmin(
    headers: Headers,
  ): Promise<{ allowed: true } | { allowed: false; status: 401 | 403 }>;
};
export function createAdminAuthorizer(): AdminAuthorizer {
  const verify = createTokenVerifier();
  return {
    async requireAdmin(headers) {
      const claims = await verify(headers.get('authorization'));
      if (!claims) return { allowed: false, status: 401 };
      return claims.role === 'admin' ? { allowed: true } : { allowed: false, status: 403 };
    },
  };
}
