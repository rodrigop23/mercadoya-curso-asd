import { createInventoryRoutes } from './routes.js';
import {
  eventSubjects,
  inventoryRejectedEventSchema,
  inventoryReservedEventSchema,
  orderPlacedEventSchema,
  type CatalogStockContract,
} from '@mercadoya/contracts';
import { createInventoryContract } from './service.js';
import type { IdentityContract } from '../identity/contract.js';
import type { EventBus } from '../events/event-bus.js';
import { logEvent } from '../events/logger.js';
export type { InventoryPort, ReservationResult } from '@mercadoya/contracts';

export function createInventoryModule(
  catalog: CatalogStockContract,
  eventBus: EventBus,
  identity: IdentityContract,
) {
  const contract = createInventoryContract(catalog);

  return {
    contract,
    routes: createInventoryRoutes(identity),
    async onOrderPlaced(payload: unknown) {
      const event = orderPlacedEventSchema.parse(payload);
      const result = await contract.reserve({
        orderId: event.orderId,
        productId: event.productId,
        quantity: event.quantity,
      });
      const occurredAt = new Date().toISOString();

      if (result.reserved) {
        const reservationEvent = inventoryReservedEventSchema.parse({
          version: 1,
          orderId: event.orderId,
          productId: event.productId,
          quantity: event.quantity,
          buyerId: event.buyerId,
          occurredAt,
        });
        await eventBus.publish(eventSubjects.inventoryReserved, reservationEvent);
        logEvent({
          type: 'inventory.reservation',
          transport: eventBus.transport,
          outcome: 'reserved',
          orderId: event.orderId,
          productId: event.productId,
          quantity: event.quantity,
        });
        return;
      }

      const rejectionEvent = inventoryRejectedEventSchema.parse({
        version: 1,
        orderId: event.orderId,
        productId: event.productId,
        quantity: event.quantity,
        buyerId: event.buyerId,
        reason: result.reason,
        occurredAt,
      });
      await eventBus.publish(eventSubjects.inventoryRejected, rejectionEvent);
      logEvent({
        type: 'inventory.reservation',
        transport: eventBus.transport,
        outcome: 'rejected',
        orderId: event.orderId,
        productId: event.productId,
        quantity: event.quantity,
        reason: result.reason,
      });
    },
  };
}
