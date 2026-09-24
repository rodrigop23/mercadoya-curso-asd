import type { NatsConnection } from '@nats-io/transport-node';

import { logEvent, logEventHandlerError } from './logger.js';
import type { EventSubject } from './subjects.js';
export type EventHandler<T> = (payload: T) => void | Promise<void>;

export interface EventBus {
  readonly transport: 'nats' | 'inprocess';
  publish<K extends EventSubject>(subject: K, payload: unknown): Promise<void>;
  subscribe<K extends EventSubject, T>(
    subject: K,
    consumer: string,
    handler: EventHandler<T>,
  ): Promise<void>;
  close(): Promise<void>;
}

type RegisteredHandler = { consumer: string; handler: EventHandler<unknown> };

export function createInProcessEventBus(): EventBus {
  const handlers = new Map<EventSubject, RegisteredHandler[]>();

  return {
    transport: 'inprocess',

    async publish(subject, payload) {
      logEvent({
        type: 'event.publish',
        transport: 'inprocess',
        subject,
        ...eventMetadata(payload),
      });

      for (const subscriber of handlers.get(subject) ?? []) {
        const message = JSON.parse(JSON.stringify(payload)) as unknown;
        void Promise.resolve()
          .then(() => {
            logEvent({
              type: 'event.consume',
              transport: 'inprocess',
              subject,
              consumer: subscriber.consumer,
              ...eventMetadata(message),
            });
            return subscriber.handler(message);
          })
          .catch((error: unknown) => {
            logEventHandlerError({
              subject,
              consumer: subscriber.consumer,
              transport: 'inprocess',
              error,
            });
          });
      }
    },

    async subscribe(subject, consumer, handler) {
      const subscribers = handlers.get(subject) ?? [];
      subscribers.push({ consumer, handler: handler as EventHandler<unknown> });
      handlers.set(subject, subscribers);
    },

    async close() {},
  };
}

export function createNatsEventBus(connection: NatsConnection): EventBus {
  return {
    transport: 'nats',

    async publish(subject, payload) {
      logEvent({ type: 'event.publish', transport: 'nats', subject, ...eventMetadata(payload) });
      connection.publish(subject, JSON.stringify(payload));
      await connection.flush();
    },

    async subscribe(subject, consumer, handler) {
      const subscription = connection.subscribe(subject);
      void (async () => {
        for await (const message of subscription) {
          try {
            const payload = JSON.parse(new TextDecoder().decode(message.data)) as unknown;
            logEvent({
              type: 'event.consume',
              transport: 'nats',
              subject,
              consumer,
              ...eventMetadata(payload),
            });
            await handler(payload as Parameters<typeof handler>[0]);
          } catch (error) {
            logEventHandlerError({ subject, consumer, transport: 'nats', error });
          }
        }
      })().catch((error: unknown) => {
        logEventHandlerError({ subject, consumer, transport: 'nats', error });
      });
      await connection.flush();
    },

    async close() {
      if (!connection.isClosed()) {
        await connection.drain();
      }
    },
  };
}

function eventMetadata(payload: unknown): { orderId?: string } {
  if (typeof payload !== 'object' || payload === null || !('orderId' in payload)) {
    return {};
  }

  const orderId = payload.orderId;
  return typeof orderId === 'string' ? { orderId } : {};
}
