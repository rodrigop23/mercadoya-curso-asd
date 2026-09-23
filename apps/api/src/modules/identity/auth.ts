import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { config } from 'dotenv';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

config({ path: fileURLToPath(new URL('../../../../../.env', import.meta.url)) });

const secret = process.env.BETTER_AUTH_SECRET;

if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is required to start the API.');
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  basePath: '/api/auth',
  secret,
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  trustedOrigins: ['http://localhost:5173'],
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      userRoles: ['user'],
    }),
  ],
});
