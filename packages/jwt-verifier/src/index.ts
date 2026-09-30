import { createRemoteJWKSet, jwtVerify, errors } from 'jose';

export type ApplicationClaims = { sub: string; role: 'user' | 'admin' };

export function createTokenVerifier(
  options: {
    jwksURL?: string;
    issuer?: string;
    audience?: string;
  } = {},
) {
  const keys = createRemoteJWKSet(
    new URL(
      options.jwksURL ??
        process.env.IDENTITY_JWKS_URL ??
        `${process.env.IDENTITY_URL ?? 'http://localhost:3006'}/api/auth/jwks`,
    ),
    {
      timeoutDuration: 3000,
      cacheMaxAge: 60000,
      cooldownDuration: 5000,
    },
  );
  return async (authorization: string | null): Promise<ApplicationClaims | null> => {
    if (!authorization?.startsWith('Bearer ')) return null;
    try {
      const { payload, protectedHeader } = await jwtVerify(authorization.slice(7), keys, {
        algorithms: ['RS256'],
        issuer: options.issuer ?? process.env.JWT_ISSUER ?? 'http://localhost:8000',
        audience: options.audience ?? process.env.JWT_AUDIENCE ?? 'mercadoya-services',
        requiredClaims: ['sub', 'iss', 'aud', 'iat', 'exp'],
        maxTokenAge: '5m',
      });
      if (
        !protectedHeader.kid ||
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        !['user', 'admin'].includes(String(payload.role))
      )
        return null;
      return { sub: payload.sub, role: payload.role as ApplicationClaims['role'] };
    } catch (error) {
      // Credential failures return 401. Network/configuration failures propagate as 5xx.
      if (error instanceof errors.JOSEError && error.code !== 'ERR_JWKS_TIMEOUT') return null;
      throw error;
    }
  };
}
