import { createInventoryRoutes } from './routes.js';
import type { CatalogContract } from '../catalog/contract.js';
import { createInventoryContract } from './service.js';
import type { EventBus } from '../../events/event-bus.js';
import { logEvent } from '../../events/logger.js';
import { orderPlacedEventSchema } from '../orders/events.js';
import {
  inventoryRejectedEventSchema,
  inventoryReservedEventSchema,
  inventoryRejectedSubject,
  inventoryReservedSubject,
} from './events.js';

export type { InventoryPort, ReservationResult } from './ports.js';

export function createInventoryModule(catalog: CatalogContract, eventBus: EventBus) {
  const contract = createInventoryContract(catalog);

  return {
    contract,
    routes: createInventoryRoutes(),
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
        await eventBus.publish(inventoryReservedSubject, reservationEvent);
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
      await eventBus.publish(inventoryRejectedSubject, rejectionEvent);
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
