import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { connect } from '@nats-io/transport-node';
import { handler } from './handler.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

if ((process.env.EVENT_BUS?.trim().toLowerCase() || 'nats') !== 'nats') {
  throw new Error('Notifications bridge requiere EVENT_BUS=nats.');
}
const invokeToken = process.env.NOTIFICATIONS_INVOKE_TOKEN ?? '';
if (!invokeToken) throw new Error('Configura NOTIFICATIONS_INVOKE_TOKEN.');
const functionUrl = process.env.NOTIFICATIONS_FUNCTION_URL?.trim();
const subjects = [
  ['orders.placed', 'notifications.order-placed'],
  ['inventory.reserved', 'notifications.order-confirmed'],
  ['inventory.rejected', 'notifications.order-rejected'],
] as const;
const connection = await connect({
  servers: process.env.NATS_URL?.trim() || 'nats://localhost:4222',
  name: 'mercadoya-notifications-bridge',
  timeout: 2_000,
  maxReconnectAttempts: 0,
});

async function invoke(subject: string, payload: unknown) {
  const body = JSON.stringify({ subject, payload });
  if (functionUrl) {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-invoke-token': invokeToken },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Function URL respondió ${response.status}.`);
    return;
  }
  const result = await handler({ body, headers: { 'x-invoke-token': invokeToken } });
  if (result.statusCode !== 202)
    throw new Error(`Handler local respondió ${result.statusCode}: ${result.body}`);
}

for (const [subject, consumer] of subjects) {
  const subscription = connection.subscribe(subject, { queue: consumer });
  void (async () => {
    for await (const message of subscription) {
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(message.data));
        console.info(
          JSON.stringify({ type: 'event.consume', transport: 'nats', subject, consumer }),
        );
        await invoke(subject, payload);
      } catch (error) {
        console.error(
          JSON.stringify({
            type: 'event.handler_error',
            transport: 'nats',
            subject,
            consumer,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  })().catch((error: unknown) => console.error(error));
}
await connection.flush();
const port = Number(process.env.NOTIFICATIONS_BRIDGE_PORT ?? 3004);
const server = createServer((request, response) => {
  if (request.url === '/api/notifications/health' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        module: 'notifications',
        ok: true,
        runtime: functionUrl ? 'lambda-url' : 'local-handler',
      }),
    );
    return;
  }
  response.writeHead(404).end();
});
server.listen(port, () =>
  console.info(`Notifications bridge listening on http://localhost:${port}`),
);
console.info(
  JSON.stringify({
    type: 'event.transport',
    transport: 'nats',
    server: connection.getServer(),
    invocation: functionUrl ? 'lambda-url' : 'local-handler',
  }),
);

const shutdown = async () => {
  server.close();
  if (!connection.isClosed()) await connection.drain();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
