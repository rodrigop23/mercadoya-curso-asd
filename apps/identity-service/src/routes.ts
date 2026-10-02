import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { signUpSchema, signInSchema } from '@mercadoya/contracts';

import { auth } from './auth.js';
import type { IdentityContract } from './contract.js';

function requestWithValidatedBody(request: Request, body: unknown) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
  });
}

export function createIdentityRoutes(identity: IdentityContract) {
  const routes = new Hono();

  routes.get('/api/identity/health', (c) => c.json({ module: 'identity', ok: true }));

  routes.post('/api/auth/sign-up/email', zValidator('json', signUpSchema), (c) => {
    return auth.handler(requestWithValidatedBody(c.req.raw, c.req.valid('json')));
  });

  routes.post('/api/auth/sign-in/email', zValidator('json', signInSchema), (c) => {
    return auth.handler(requestWithValidatedBody(c.req.raw, c.req.valid('json')));
  });

  routes.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  routes.get('/api/me', async (c) => {
    const session = await identity.getSession(c.req.raw.headers);

    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return c.json(session);
  });

  return routes;
}
