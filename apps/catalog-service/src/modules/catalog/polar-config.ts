import { z } from 'zod';

export function polarServer(env: NodeJS.ProcessEnv = process.env) {
  return z.enum(['sandbox', 'production']).parse(env.POLAR_SERVER || 'sandbox');
}

export function catalogPolarConfig(env: NodeJS.ProcessEnv = process.env) {
  z.literal('polar').parse(env.PAYMENT_PROVIDER?.trim() || 'polar');
  if (!env.POLAR_ACCESS_TOKEN) throw new Error('Configura POLAR_ACCESS_TOKEN para Catalog.');
  return { accessToken: env.POLAR_ACCESS_TOKEN, server: polarServer(env) };
}
