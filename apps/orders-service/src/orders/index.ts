import { createOrdersRoutes } from './routes.js';
import type { IdentityContract } from '../identity/contract.js';
import type { EventBus } from '../events/event-bus.js';
import { logEvent } from '../events/logger.js';
import { createOrdersService } from './service.js';
import type { PaymentCheckoutResponse } from '@mercadoya/contracts';
import type { CatalogBillingPort } from '../catalog/http.js';

export function createOrdersModule(
  eventBus: EventBus,
  identity: IdentityContract,
  payments: { getCheckout(orderId: string): Promise<PaymentCheckoutResponse> },
  catalog: CatalogBillingPort,
) {
  const service = createOrdersService(eventBus, catalog);

  return {
    routes: createOrdersRoutes(service, identity, payments),
    onPaymentSucceeded: async (event: { orderId: string }) => {
      const order = await service.recordSagaResult({
        orderId: event.orderId,
        status: 'confirmed',
        rejectionReason: null,
      });

      logEvent({
        type: order ? 'orders.status_updated' : 'orders.status_ignored',
        transport: eventBus.transport,
        orderId: event.orderId,
        status: 'confirmed',
      });
    },
    onPaymentFailed: async (event: { orderId: string; reason: string }) => {
      await service.recordSagaResult({
        orderId: event.orderId,
        status: 'rejected',
        rejectionReason: event.reason,
      });
    },
    onInventoryReleased: async (event: { orderId: string }) => {
      await service.recordSagaResult({
        orderId: event.orderId,
        status: 'rejected',
        rejectionReason: 'payment_failed',
      });
    },
    onInventoryRejected: async (event: { orderId: string; reason: string }) => {
      const order = await service.recordSagaResult({
        orderId: event.orderId,
        status: 'rejected',
        rejectionReason: event.reason,
      });

      logEvent({
        type: order ? 'orders.status_updated' : 'orders.status_ignored',
        transport: eventBus.transport,
        orderId: event.orderId,
        status: 'rejected',
        reason: event.reason,
      });
    },
  };
}
