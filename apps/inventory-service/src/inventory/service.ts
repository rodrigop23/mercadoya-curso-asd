import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { CatalogStockContract, InventoryPort, ReservationResult } from '@mercadoya/contracts';
import { inventoryReservation } from './schema.js';

export function createInventoryContract(catalog: CatalogStockContract): InventoryPort & {
  release(orderId: string): Promise<{ productId: string; quantity: number } | null>;
} {
  return {
    async reserve({ orderId, productId, quantity }): Promise<ReservationResult> {
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return { reserved: false, reason: 'invalid_quantity' };
      }

      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orderId}, 0))`);
        const [existing] = await tx
          .select()
          .from(inventoryReservation)
          .where(eq(inventoryReservation.orderId, orderId));
        if (existing) {
          if (existing.productId !== productId || existing.quantity !== quantity)
            throw new Error('Reserva incompatible con orderId.');
          return { reserved: true };
        }
        const availableStock = await catalog.getAvailableStock(productId);
        if (availableStock === null) {
          return { reserved: false, reason: 'product_not_found' };
        }

        if (availableStock < quantity) {
          return { reserved: false, reason: 'insufficient_stock' };
        }

        // Catalog applies the decrement atomically, so concurrent reservations cannot oversell.
        const adjustment = await catalog.adjustStock(productId, -quantity);
        if (!adjustment.adjusted) {
          return { reserved: false, reason: adjustment.reason };
        }

        try {
          await tx.insert(inventoryReservation).values({ orderId, productId, quantity });
        } catch (error) {
          const restoration = await catalog.adjustStock(productId, quantity);
          if (!restoration.adjusted) {
            console.error('No se pudo restaurar stock después de fallar la reserva:', {
              orderId,
              productId,
              quantity,
              reason: restoration.reason,
            });
          }

          throw error;
        }

        return { reserved: true };
      });
    },
    async release(orderId) {
      return db.transaction(async (tx) => {
        // El lock serializa fallos duplicados y reservas concurrentes del mismo pedido.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orderId}, 0))`);
        const [reservation] = await tx
          .select()
          .from(inventoryReservation)
          .where(eq(inventoryReservation.orderId, orderId));
        if (!reservation) return null;
        const result = await catalog.adjustStock(reservation.productId, reservation.quantity);
        if (!result.adjusted) throw new Error(`No se pudo liberar stock: ${result.reason}`);
        await tx.delete(inventoryReservation).where(eq(inventoryReservation.orderId, orderId));
        return { productId: reservation.productId, quantity: reservation.quantity };
      });
    },
  };
}
