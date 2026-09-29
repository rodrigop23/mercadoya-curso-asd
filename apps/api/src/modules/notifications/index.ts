import { createNotificationsRoutes } from './routes.js';
import type { NotificationSenderPort } from './ports.js';
import { logEvent } from '../../events/logger.js';
import { orderPlacedEventSchema } from '../orders/events.js';
import { inventoryRejectedEventSchema, inventoryReservedEventSchema } from '../inventory/events.js';

export type { NotificationSenderPort } from './ports.js';

export function createNotificationsModule(transport: 'nats' | 'inprocess') {
  const contract = createNotificationSender();

  return {
    contract,
    routes: createNotificationsRoutes(),
    async onOrderPlaced(payload: unknown) {
      const event = orderPlacedEventSchema.parse(payload);
      await contract.send({
        recipient: event.buyerId ?? 'guest',
        subject: 'Recibimos tu pedido',
        body: `El pedido ${event.orderId} está pendiente de reserva de stock.`,
        orderId: event.orderId,
        transport,
      });
    },
    async onInventoryReserved(payload: unknown) {
      const event = inventoryReservedEventSchema.parse(payload);
      await contract.send({
        recipient: event.buyerId ?? 'guest',
        subject: 'Pedido confirmado',
        body: `El pedido ${event.orderId} quedó confirmado.`,
        orderId: event.orderId,
        transport,
      });
    },
    async onInventoryRejected(payload: unknown) {
      const event = inventoryRejectedEventSchema.parse(payload);
      await contract.send({
        recipient: event.buyerId ?? 'guest',
        subject: 'Pedido rechazado',
        body: `El pedido ${event.orderId} fue rechazado: ${event.reason}.`,
        orderId: event.orderId,
        transport,
      });
    },
  };
}

function createNotificationSender(): NotificationSenderPort {
  return {
    async send(input) {
      const { subject, ...details } = input;
      logEvent({ type: 'notification.stub', ...details, notificationSubject: subject });
    },
  };
}
