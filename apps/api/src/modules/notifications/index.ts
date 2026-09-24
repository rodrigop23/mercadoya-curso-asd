import { createNotificationsRoutes } from './routes.js';
import type { NotificationSenderPort } from './ports.js';
import { orderPlacedEventSchema } from '../orders/events.js';
import { inventoryRejectedEventSchema, inventoryReservedEventSchema } from '../inventory/events.js';

export type { NotificationSenderPort } from './ports.js';

export function createNotificationsModule() {
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
      });
    },
    async onInventoryReserved(payload: unknown) {
      const event = inventoryReservedEventSchema.parse(payload);
      await contract.send({
        recipient: event.buyerId ?? 'guest',
        subject: 'Pedido confirmado',
        body: `El pedido ${event.orderId} quedó confirmado.`,
      });
    },
    async onInventoryRejected(payload: unknown) {
      const event = inventoryRejectedEventSchema.parse(payload);
      await contract.send({
        recipient: event.buyerId ?? 'guest',
        subject: 'Pedido rechazado',
        body: `El pedido ${event.orderId} fue rechazado: ${event.reason}.`,
      });
    },
  };
}

function createNotificationSender(): NotificationSenderPort {
  return {
    async send(input) {
      console.info(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'notification.stub',
          ...input,
        }),
      );
    },
  };
}
