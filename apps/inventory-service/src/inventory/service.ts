import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type {
  CartItem,
  CatalogStockContract,
  InventoryPort,
  ReservationResult,
} from '@mercadoya/contracts';
import { inventoryReservation } from './schema.js';

export function createInventoryContract(catalog: CatalogStockContract): InventoryPort & {
  release(
    orderId: string,
  ): Promise<{ productId: string; quantity: number; items?: CartItem[] } | null>;
} {
  return {
    async reserve({ orderId, productId, quantity, items }): Promise<ReservationResult> {
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
          if (
            existing.productId !== productId ||
            existing.quantity !== quantity ||
            JSON.stringify(existing.items?.map((item) => [item.productId, item.quantity])) !==
              JSON.stringify(items?.map((item) => [item.productId, item.quantity]))
          )
            throw new Error('Reserva incompatible con orderId.');
          if (existing.releasedAt) throw new Error('La reserva ya fue liberada.');
          return { reserved: true };
        }
        if (items) {
          const adjustment = await catalog.adjustStockBatch({
            operationId: `order:${orderId}:reserve`,
            adjustments: items.map((item) => ({
              productId: item.productId,
              delta: -item.quantity,
            })),
          });
          if (!adjustment.adjusted) return { reserved: false, reason: adjustment.reason };
          // El ajuste remoto es idempotente. Si falla este insert, repetir no descuenta otra vez.
          await tx.insert(inventoryReservation).values({ orderId, productId, quantity, items });
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
        if (!reservation || reservation.releasedAt) return null;
        if (reservation.items) {
          const result = await catalog.adjustStockBatch({
            operationId: `order:${orderId}:release`,
            adjustments: reservation.items.map((item) => ({
              productId: item.productId,
              delta: item.quantity,
            })),
          });
          if (!result.adjusted) throw new Error(`No se pudo liberar stock: ${result.reason}`);
          await tx
            .update(inventoryReservation)
            .set({ releasedAt: new Date() })
            .where(eq(inventoryReservation.orderId, orderId));
          return {
            productId: reservation.productId,
            quantity: reservation.quantity,
            items: reservation.items,
          };
        }
        const result = await catalog.adjustStock(reservation.productId, reservation.quantity);
        if (!result.adjusted) throw new Error(`No se pudo liberar stock: ${result.reason}`);
        await tx.delete(inventoryReservation).where(eq(inventoryReservation.orderId, orderId));
        return { productId: reservation.productId, quantity: reservation.quantity };
      });
    },
  };
}
