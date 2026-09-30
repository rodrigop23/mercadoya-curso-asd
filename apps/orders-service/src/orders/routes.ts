import { Hono } from 'hono';
import { z } from 'zod';
import { createOrderSchema } from '@mercadoya/contracts';

import type { IdentityContract } from '../identity/contract.js';
import type { createOrdersService } from './service.js';

export function createOrdersRoutes(
  orders: ReturnType<typeof createOrdersService>,
  identity: IdentityContract,
) {
  const routes = new Hono({ strict: false });

  routes.get('/health', (c) => c.json({ module: 'orders', ok: true }));

  routes.get('/:orderId', async (c) => {
    const parsedOrderId = z.string().uuid().safeParse(c.req.param('orderId'));
    if (!parsedOrderId.success) {
      return c.json({ error: 'El identificador del pedido no es válido.' }, 400);
    }

    try {
      const order = await orders.getOrder(parsedOrderId.data);
      return order ? c.json({ order }, 200) : c.json({ error: 'El pedido no existe.' }, 404);
    } catch (error) {
      console.error('No se pudo consultar el pedido:', error);
      return c.json({ error: 'No se pudo consultar el pedido.' }, 500);
    }
  });

  routes.post('/', async (c) => {
    let session: Awaited<ReturnType<IdentityContract['getSession']>>;
    try {
      session = await identity.getSession(c.req.raw.headers);
    } catch (error) {
      console.error('No se pudo validar la sesión del pedido:', error);
      return c.json({ error: 'No se pudo validar la sesión.' }, 502);
    }
    if (!session) return c.json({ error: 'Inicia sesión para crear un pedido.' }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'El cuerpo debe ser JSON válido.' }, 400);
    }

    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'Revisa los datos del pedido.',
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    try {
      const result = await orders.createOrder({
        ...parsed.data,
        buyerId: session.user.id,
      });

      return c.json({ order: result.order }, 202);
    } catch (error) {
      console.error('No se pudo crear el pedido:', error);
      return c.json({ error: 'No se pudo crear el pedido.' }, 500);
    }
  });

  return routes;
}
