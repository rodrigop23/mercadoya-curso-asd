import { z } from 'zod';

export function polarServer(env: NodeJS.ProcessEnv = process.env) {
  return z.enum(['sandbox', 'production']).parse(env.POLAR_SERVER || 'sandbox');
}

export function catalogPolarConfig(env: NodeJS.ProcessEnv = process.env) {
  const provider = z.enum(['polar', 'simulator']).parse(env.PAYMENT_PROVIDER || 'polar');
  if (provider === 'simulator') return null;
  if (!env.POLAR_ACCESS_TOKEN) throw new Error('Configura POLAR_ACCESS_TOKEN para Catalog.');
  return { accessToken: env.POLAR_ACCESS_TOKEN, server: polarServer(env) };
}
