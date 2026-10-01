import { z } from 'zod';

export function paymentProvider(env: NodeJS.ProcessEnv = process.env) {
  return z.literal('polar').parse(env.PAYMENT_PROVIDER?.trim() || 'polar');
}

export function polarConfig(env: NodeJS.ProcessEnv = process.env) {
  paymentProvider(env);
  // No imprimir valores ni errores Zod de configuración: pueden incluir credenciales.
  const schema = z.object({
    accessToken: z.string().min(1),
    webhookSecret: z.string().min(1),
    server: z.enum(['sandbox', 'production']),
    webOrigin: z.url({ protocol: /^https?$/ }),
  });
  try {
    return schema.parse({
      accessToken: env.POLAR_ACCESS_TOKEN,
      webhookSecret: env.POLAR_WEBHOOK_SECRET,
      server: env.POLAR_SERVER || 'sandbox',
      webOrigin: env.POLAR_WEB_ORIGIN || 'http://localhost:5173',
    });
  } catch {
    throw new Error(
      'Configura POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_SERVER y POLAR_WEB_ORIGIN.',
    );
  }
}
export type PolarConfig = ReturnType<typeof polarConfig>;
