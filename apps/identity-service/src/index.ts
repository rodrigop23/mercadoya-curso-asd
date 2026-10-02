import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createTokenVerifier } from '@mercadoya/jwt-verifier';
import { auth } from './auth.js';
import { createIdentityRoutes } from './routes.js';
import { identityContract } from './service.js';

const app = new Hono();
app.use(
  '/api/*',
  cors({ origin: ['http://localhost:5173', 'http://localhost:5174'], credentials: true }),
);
const verify = createTokenVerifier();
// Internal authentication endpoint. No user headers are trusted; verify every credential.
app.post('/api/identity/verify', async (c) => {
  c.header('Cache-Control', 'no-store');
  const authorization = c.req.header('authorization');
  if (authorization !== undefined) {
    const claims = await verify(authorization);
    if (!claims) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({ token: authorization.slice(7) });
  }
  const origin = c.req.header('origin');
  if (
    origin &&
    ![
      'http://localhost:5173',
      'http://localhost:5174',
      process.env.BETTER_AUTH_URL ?? 'http://localhost:8000',
    ].includes(origin)
  ) {
    return c.json({ error: 'Origen inválido' }, 403);
  }
  const session = await identityContract.getSession(c.req.raw.headers);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const token = await auth.api.getToken({ headers: c.req.raw.headers });
  return c.json(token);
});
app.route('/', createIdentityRoutes(identityContract));
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3006) });
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
