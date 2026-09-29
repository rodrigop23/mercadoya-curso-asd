import { connect } from '@nats-io/transport-node';

import { createNatsEventBus } from './event-bus.js';
import { logEvent } from './logger.js';

export async function createEventBusFromEnv() {
  const mode = process.env.EVENT_BUS?.trim().toLowerCase() || 'nats';

  if (mode !== 'nats') {
    throw new Error(`EVENT_BUS debe ser "nats" con Orders separado; se recibió "${mode}".`);
  }

  const servers = process.env.NATS_URL?.trim() || 'nats://localhost:4222';

  const connection = await connect({
    servers,
    name: 'mercadoya-api',
    timeout: 2_000,
    maxReconnectAttempts: 0,
  });
  logEvent({ type: 'event.transport', transport: 'nats', server: connection.getServer() });
  return createNatsEventBus(connection);
}
