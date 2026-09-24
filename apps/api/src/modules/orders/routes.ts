import { Hono } from 'hono';
import { z } from 'zod';

import type { IdentityContract } from '../identity/contract.js';
import type { InventoryReservationPort } from './ports.js';
import { createOrdersService } from './service.js';

const createOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(2_147_483_647),
});

export function createOrdersRoutes(
  inventory: InventoryReservationPort,
  identity: IdentityContract,
) {
  const routes = new Hono({ strict: false });
  const orders = createOrdersService(inventory);

  routes.get('/health', (c) => c.json({ module: 'orders', ok: true }));

  routes.post('/', async (c) => {
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
      const session = await identity.getSession(c.req.raw.headers);
      const result = await orders.createOrder({
        ...parsed.data,
        buyerId: session?.user.id ?? null,
      });

      if (!result.reservation.reserved) {
        const error =
          result.reservation.reason === 'insufficient_stock'
            ? 'No hay stock suficiente para este producto.'
            : result.reservation.reason === 'product_not_found'
              ? 'El producto no existe.'
              : 'No se pudo reservar el stock.';

        return c.json(
          {
            order: result.order,
            error,
            reason: result.reservation.reason,
          },
          409,
        );
      }

      return c.json({ order: result.order, reservation: result.reservation }, 201);
    } catch (error) {
      console.error('No se pudo crear el pedido:', error);
      return c.json({ error: 'No se pudo crear el pedido.' }, 500);
    }
  });

  return routes;
}
