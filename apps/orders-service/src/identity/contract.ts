import { createTokenVerifier } from '@mercadoya/jwt-verifier';
export type IdentityContract = {
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
};
export function createIdentityContract(): IdentityContract {
  const verify = createTokenVerifier();
  return {
    async getSession(headers) {
      const claims = await verify(headers.get('authorization'));
      return claims ? { user: { id: claims.sub } } : null;
    },
  };
}
