import { Hono } from 'hono';
import { z } from 'zod';
import { createOrderSchema, type PaymentCheckoutResponse } from '@mercadoya/contracts';

import type { IdentityContract } from '../identity/contract.js';
import type { createOrdersService } from './service.js';
import { CatalogBillingError } from '../catalog/http.js';

export function createOrdersRoutes(
  orders: ReturnType<typeof createOrdersService>,
  identity: IdentityContract,
  payments?: { getCheckout(orderId: string): Promise<PaymentCheckoutResponse> },
) {
  const routes = new Hono({ strict: false });

  routes.get('/health', (c) => c.json({ module: 'orders', ok: true }));

  routes.get('/:orderId/checkout', async (c) => {
    const session = await identity.getSession(c.req.raw.headers);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const orderId = z.uuid().safeParse(c.req.param('orderId'));
    if (!orderId.success) return c.json({ error: 'Pedido inválido.' }, 400);
    try {
      const order = await orders.getOrder(orderId.data);
      if (!order || order.buyerId !== session.user.id)
        return c.json({ error: 'El pedido no existe.' }, 404);
      c.header('Cache-Control', 'no-store');
      if (!payments) return c.json({ provider: 'simulator', checkout: null }, 200);
      const result = await payments.getCheckout(orderId.data);
      return c.json(result, result.checkout || order.status !== 'pending' ? 200 : 202);
    } catch {
      return c.json({ error: 'No se pudo consultar el checkout.' }, 503);
    }
  });

  routes.get('/:orderId', async (c) => {
    const session = await identity.getSession(c.req.raw.headers);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
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
      if (error instanceof CatalogBillingError)
        return c.json({ error: error.message }, error.status);
      console.error('No se pudo crear el pedido:', error);
      return c.json({ error: 'No se pudo crear el pedido.' }, 500);
    }
  });

  return routes;
}
