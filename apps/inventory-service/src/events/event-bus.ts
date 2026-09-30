import { connect } from '@nats-io/transport-node';
import type { NatsConnection } from '@nats-io/transport-node';
import type { EventSubject } from '@mercadoya/contracts';
import { logEvent } from './logger.js';

export interface EventBus {
  readonly transport: 'nats';
  publish(subject: EventSubject, payload: unknown): Promise<void>;
  subscribe(
    subject: EventSubject,
    consumer: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void>;
  close(): Promise<void>;
}

export async function createEventBus(): Promise<EventBus> {
  const mode = process.env.EVENT_BUS?.trim().toLowerCase() || 'nats';
  if (mode !== 'nats') {
    throw new Error('inventory-service requiere EVENT_BUS=nats.');
  }

  const connection = await connect({
    servers: process.env.NATS_URL?.trim() || 'nats://localhost:4222',
    name: 'mercadoya-inventory-service',
    timeout: 2_000,
    maxReconnectAttempts: 0,
  });
  logEvent({ type: 'event.transport', transport: 'nats', server: connection.getServer() });
  return createNatsEventBus(connection);
}

function createNatsEventBus(connection: NatsConnection): EventBus {
  return {
    transport: 'nats',
    async publish(subject, payload) {
      connection.publish(subject, JSON.stringify(payload));
      await connection.flush();
      logEvent({ type: 'event.publish', transport: 'nats', subject, ...eventMetadata(payload) });
    },
    async subscribe(subject, consumer, handler) {
      const subscription = connection.subscribe(subject);
      void (async () => {
        for await (const message of subscription) {
          let payload: unknown;
          try {
            payload = JSON.parse(new TextDecoder().decode(message.data)) as unknown;
            logEvent({
              type: 'event.consume',
              transport: 'nats',
              subject,
              consumer,
              ...eventMetadata(payload),
            });
            await handler(payload);
          } catch (error) {
            logEvent({
              type: 'event.handler_error',
              transport: 'nats',
              subject,
              consumer,
              ...eventMetadata(payload),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })().catch((error: unknown) => {
        logEvent({
          type: 'event.handler_error',
          transport: 'nats',
          subject,
          consumer,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      await connection.flush();
    },
    async close() {
      if (!connection.isClosed()) await connection.drain();
    },
  };
}

function eventMetadata(payload: unknown): { orderId?: string } {
  if (typeof payload !== 'object' || payload === null || !('orderId' in payload)) return {};
  return typeof payload.orderId === 'string' ? { orderId: payload.orderId } : {};
}
