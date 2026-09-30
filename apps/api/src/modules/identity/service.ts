import { createTokenVerifier } from '@mercadoya/jwt-verifier';
import type { IdentityContract, IdentitySession } from './contract.js';

const verify = createTokenVerifier();
export const identityContract: IdentityContract = {
  async getSession(headers) {
    const response = await fetch(
      new URL('/api/me', process.env.IDENTITY_URL ?? 'http://localhost:3006'),
      {
        headers: { cookie: headers.get('cookie') ?? '' },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Identity respondió ${response.status}`);
    return (await response.json()) as IdentitySession;
  },
  async requireAdmin(headers) {
    if (headers.has('authorization')) {
      const claims = await verify(headers.get('authorization'));
      if (!claims) return { allowed: false, status: 401 };
      return claims.role === 'admin' ? { allowed: true } : { allowed: false, status: 403 };
    }
    const session = await identityContract.getSession(headers);
    if (!session) return { allowed: false, status: 401 };
    return session.user.role === 'admin' ? { allowed: true } : { allowed: false, status: 403 };
  },
};
