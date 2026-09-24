import { createOrdersRoutes } from './routes.js';
import type { IdentityContract } from '../identity/contract.js';
import type { EventBus } from '../../events/event-bus.js';
import { logEvent } from '../../events/logger.js';
import { createOrdersService } from './service.js';

export function createOrdersModule(eventBus: EventBus, identity: IdentityContract) {
  const service = createOrdersService(eventBus);

  return {
    routes: createOrdersRoutes(service, identity),
    onInventoryReserved: async (event: { orderId: string }) => {
      const order = await service.recordInventoryResult({
        orderId: event.orderId,
        status: 'confirmed',
        rejectionReason: null,
      });

      logEvent({
        type: order ? 'orders.status_updated' : 'orders.status_ignored',
        orderId: event.orderId,
        status: 'confirmed',
      });
    },
    onInventoryRejected: async (event: { orderId: string; reason: string }) => {
      const order = await service.recordInventoryResult({
        orderId: event.orderId,
        status: 'rejected',
        rejectionReason: event.reason,
      });

      logEvent({
        type: order ? 'orders.status_updated' : 'orders.status_ignored',
        orderId: event.orderId,
        status: 'rejected',
        reason: event.reason,
      });
    },
  };
}
