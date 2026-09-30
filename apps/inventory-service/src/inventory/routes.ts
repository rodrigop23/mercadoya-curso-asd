import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  reservationResponseV1Schema,
  reservationResponseV2Schema,
} from '@mercadoya/contracts';

import { db } from '../db/index.js';
import type { IdentityContract } from '../identity/contract.js';
import { inventoryReservation } from './schema.js';

export function createInventoryRoutes(identity: IdentityContract, serviceVersion: 'v1' | 'v2') {
  const routes = new Hono();

  routes.use('*', async (c, next) => {
    await next();
    c.header('X-Service-Version', serviceVersion);
  });

  const health = (c: Context) =>
    c.json({ module: 'inventory', ok: true, serviceVersion });

  routes.get(`/${serviceVersion}/health`, health);
  if (serviceVersion === 'v1') routes.get('/health', health);

  const getReservation = async (c: Context) => {
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
      if (!reservation) return c.json({ error: 'La reserva no existe.' }, 404);

      const base = {
        id: reservation.id,
        orderId: reservation.orderId,
        productId: reservation.productId,
        quantity: reservation.quantity,
        createdAt: reservation.createdAt.toISOString(),
      };
      return serviceVersion === 'v2'
        ? c.json(reservationResponseV2Schema.parse({ reservation: { ...base, status: 'reserved' } }))
        : c.json(reservationResponseV1Schema.parse({ reservation: base }));
    } catch (error) {
      console.error('No se pudo consultar la reserva:', error);
      return c.json({ error: 'No se pudo consultar la reserva.' }, 500);
    }
  };

  routes.get(`/${serviceVersion}/reservations/:orderId`, getReservation);
  if (serviceVersion === 'v1') routes.get('/reservations/:orderId', getReservation);

  return routes;
}
