import { connect } from '@nats-io/transport-node';

import { createInProcessEventBus, createNatsEventBus } from './event-bus.js';
import { logEvent } from './logger.js';

export async function createEventBusFromEnv() {
  const mode = process.env.EVENT_BUS?.trim().toLowerCase() || 'nats';

  if (mode === 'inprocess') {
    logEvent({ type: 'event.transport', transport: 'inprocess', reason: 'configured' });
    return createInProcessEventBus();
  }

  if (mode !== 'nats') {
    throw new Error(`EVENT_BUS debe ser "nats" o "inprocess"; se recibió "${mode}".`);
  }

  const servers = process.env.NATS_URL?.trim() || 'nats://localhost:4222';

  try {
    const connection = await connect({
      servers,
      name: 'mercadoya-api',
      timeout: 2_000,
      maxReconnectAttempts: 0,
    });
    logEvent({ type: 'event.transport', transport: 'nats', server: connection.getServer() });
    return createNatsEventBus(connection);
  } catch (error) {
    logEvent({
      type: 'event.transport_fallback',
      configured: 'nats',
      transport: 'inprocess',
      server: servers,
      reason: error instanceof Error ? error.message : String(error),
    });
    return createInProcessEventBus();
  }
}
