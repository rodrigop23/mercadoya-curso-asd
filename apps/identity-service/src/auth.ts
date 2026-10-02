import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { admin, jwt } from 'better-auth/plugins';
import { db } from './db/index.js';

const secret = process.env.BETTER_AUTH_SECRET;

if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is required to start Identity.');
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8000',
  basePath: '/api/auth',
  secret,
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  trustedOrigins: ['http://localhost:5173', 'http://localhost:5174'],
  session: { cookieCache: { enabled: false } },
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwks: { keyPairConfig: { alg: 'RS256' }, rotationInterval: 86400 * 30, gracePeriod: 86400 },
      jwt: {
        issuer: process.env.JWT_ISSUER ?? 'http://localhost:8000',
        audience: process.env.JWT_AUDIENCE ?? 'mercadoya-services',
        expirationTime: '5m',
        definePayload: ({ user }) => ({ role: user.role ?? 'user' }),
      },
    }),
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      userRoles: ['user'],
    }),
  ],
});
