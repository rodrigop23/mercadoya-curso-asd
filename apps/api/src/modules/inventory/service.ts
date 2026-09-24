import { db } from '../../db/index.js';
import type { CatalogContract } from '../catalog/contract.js';
import type { InventoryPort, ReservationResult } from './ports.js';
import { inventoryReservation } from './schema.js';

export function createInventoryContract(catalog: CatalogContract): InventoryPort {
  return {
    async reserve({ orderId, productId, quantity }): Promise<ReservationResult> {
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return { reserved: false, reason: 'invalid_quantity' };
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
        await db.insert(inventoryReservation).values({ orderId, productId, quantity });
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
    },
  };
}
