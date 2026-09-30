import type { z } from 'zod';
import { sessionBuyerSchema } from '@mercadoya/contracts';

export type IdentityContract = {
  getSession(headers: Headers): Promise<z.infer<typeof sessionBuyerSchema> | null>;
};

export function createIdentityContract(): IdentityContract {
  const origin = new URL(process.env.IDENTITY_URL || 'http://localhost:3001');
  return {
    async getSession(headers) {
      const forwarded = new Headers();
      for (const name of ['cookie', 'authorization']) {
        const value = headers.get(name);
        if (value) forwarded.set(name, value);
      }
      const response = await fetch(new URL('/api/me', origin), { headers: forwarded });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error(`Identity respondió ${response.status}.`);
      return sessionBuyerSchema.parse(await response.json());
    },
  };
}
