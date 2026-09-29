import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/index.js';
import type { IdentityContract } from '../identity/contract.js';
import { inventoryReservation } from './schema.js';

export function createInventoryRoutes(identity: IdentityContract) {
  const routes = new Hono();

  routes.get('/health', (c) => c.json({ module: 'inventory', ok: true }));

  routes.get('/reservations/:orderId', async (c) => {
    try {
      const session = await identity.getSession(c.req.raw.headers);
      if (!session) return c.json({ error: 'Inicia sesión para consultar reservas.' }, 401);
    } catch (error) {
      console.error('No se pudo validar la sesión de Inventory:', error);
      return c.json({ error: 'No se pudo validar la sesión.' }, 502);
    }

    const orderId = z.uuid().safeParse(c.req.param('orderId'));
    if (!orderId.success) {
      return c.json({ error: 'El identificador del pedido no es válido.' }, 400);
    }

    try {
      const [reservation] = await db
        .select()
        .from(inventoryReservation)
        .where(eq(inventoryReservation.orderId, orderId.data))
        .limit(1);
      return reservation
        ? c.json({ reservation })
        : c.json({ error: 'La reserva no existe.' }, 404);
    } catch (error) {
      console.error('No se pudo consultar la reserva:', error);
      return c.json({ error: 'No se pudo consultar la reserva.' }, 500);
    }
  });

  return routes;
}
