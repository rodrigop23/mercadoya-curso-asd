import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  eventSubjects,
  paymentFailedEventSchema,
  reservationResponseV2Schema,
} from '@mercadoya/contracts';
import { createEventBus } from './events/event-bus.js';
import { closeDb } from './db/index.js';
import { createOrdersService } from './orders/service.js';

// CLI interno de clase: usa la persistencia de Orders y observa NATS antes de publicar.
const origin = process.env.CATALOG_URL || 'http://localhost:3007';
const gatewayOrigin = process.env.GATEWAY_URL || 'http://localhost:8000';
const token = process.env.CATALOG_INTERNAL_TOKEN;
assert(token, 'Configura CATALOG_INTERNAL_TOKEN en .env.');
async function read(path: string, base = origin) {
  const response = await fetch(new URL(path, base), {
    headers: { 'x-catalog-internal-token': token! },
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok, `HTTP ${response.status} al consultar ${path}`);
  return response.json();
}
// Una sesión de demo permite verificar el borde HTTP público y las reservas v2.
const signup = await fetch(new URL('/api/auth/sign-up/email', gatewayOrigin), {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
  body: JSON.stringify({
    name: 'Demo saga',
    email: `demo-saga-${crypto.randomUUID()}@example.com`,
    password: crypto.randomUUID(),
  }),
});
assert(signup.ok, `Signup de demo: HTTP ${signup.status}`);
const cookie = signup.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .join('; ');
assert(cookie, 'Signup no devolvió cookie de sesión.');
for (const version of ['v1', 'v2']) {
  const response = await fetch(new URL(`/api/inventory/${version}/health`, gatewayOrigin));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-service-version'), version);
}
const bus = await createEventBus();
const trace = new Map<string, { subject: string; payload: unknown }[]>();
try {
  for (const subject of Object.values(eventSubjects)) {
    await bus.subscribe(subject, 'demo.saga', async (payload) => {
      const { orderId } = payload as { orderId: string };
      const events = trace.get(orderId) ?? [];
      events.push({ subject, payload });
      trace.set(orderId, events);
    });
  }
  const products = (await read('/api/products')) as { products: { id: string; stock: number }[] };
  const productId = process.env.DEMO_PRODUCT_ID ?? products.products.find((p) => p.stock >= 2)?.id;
  assert(productId, 'Crea un producto de clase con al menos 2 unidades o define DEMO_PRODUCT_ID.');
  const stock = async () =>
    (await read(`/api/internal/catalog/products/${productId}/stock`)).availableStock as number;
  assert((await stock()) >= 2, 'La demo requiere al menos 2 unidades.');
  const service = createOrdersService(bus);
  async function scenario(
    name: string,
    mode: 'succeed' | 'fail',
    quantity: number,
    status: string,
    expected: string[],
  ) {
    const before = await stock();
    const input = { productId: productId!, quantity };
    let order: { id: string };
    if (mode === 'succeed') {
      const response = await fetch(new URL('/api/orders', gatewayOrigin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:5173' },
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 202);
      ({ order } = await response.json());
    } else {
      // El override de pago sigue siendo exclusivo del CLI interno.
      ({ order } = await service.createOrder({ ...input, buyerId: null, paymentMode: mode }));
    }
    const deadline = Date.now() + 15000;
    let finished = false;
    while (Date.now() < deadline) {
      const result = await (
        await fetch(new URL(`/api/orders/${order.id}`, gatewayOrigin), { headers: { cookie } })
      ).json();
      const subjects = (trace.get(order.id) ?? []).map((e) => e.subject);
      if (
        result.order.status === status &&
        expected.every((subject) => subjects.includes(subject))
      ) {
        finished = true;
        break;
      }
      await delay(100);
    }
    assert(finished, `Timeout en ${name}: ${JSON.stringify(trace.get(order.id))}`);
    // Deja terminar handlers antes de comprobar eventos ausentes y stock final.
    await delay(300);
    const events = trace.get(order.id)!;
    assert.deepEqual(
      events.map((e) => e.subject),
      expected,
      `${name}: secuencia inesperada`,
    );
    assert.equal(
      await stock(),
      status === 'confirmed' ? before - quantity : before,
      `${name}: stock incorrecto`,
    );
    for (const prefix of ['/api/inventory/v2', '/api/inventory']) {
      const response = await fetch(new URL(`${prefix}/reservations/${order.id}`, gatewayOrigin), {
        headers: { cookie },
      });
      assert.equal(response.headers.get('x-service-version'), 'v2');
      assert.equal(response.headers.get('deprecation'), null);
      if (status === 'confirmed') {
        assert.equal(response.status, 200);
        const { reservation } = reservationResponseV2Schema.parse(await response.json());
        assert.equal(reservation.orderId, order.id);
        assert.equal(reservation.status, 'reserved');
      } else {
        assert.equal(response.status, 404);
      }
    }
    console.log(`${name}: ${order.id}, ${status}, stock ${before} -> ${await stock()}`);
    console.log(expected.join(' -> '));
    return { order, events };
  }
  await scenario('Pago OK', 'succeed', 1, 'confirmed', [
    eventSubjects.ordersPlaced,
    eventSubjects.inventoryReserved,
    eventSubjects.paymentSucceeded,
  ]);
  await scenario('Stock insuficiente', 'succeed', (await stock()) + 1, 'rejected', [
    eventSubjects.ordersPlaced,
    eventSubjects.inventoryRejected,
  ]);
  const failed = await scenario('Pago fallido y compensación', 'fail', 1, 'rejected', [
    eventSubjects.ordersPlaced,
    eventSubjects.inventoryReserved,
    eventSubjects.paymentFailed,
    eventSubjects.inventoryReleased,
  ]);
  const beforeDuplicate = await stock();
  const failure = paymentFailedEventSchema.parse(
    failed.events.find((e) => e.subject === eventSubjects.paymentFailed)!.payload,
  );
  await Promise.all([
    bus.publish(eventSubjects.paymentFailed, failure),
    bus.publish(eventSubjects.paymentFailed, failure),
  ]);
  await delay(1000);
  assert.equal(await stock(), beforeDuplicate, 'Fallos duplicados modificaron stock.');
  assert.equal(
    trace.get(failed.order.id)!.filter((e) => e.subject === eventSubjects.inventoryReleased).length,
    1,
    'Liberación duplicada.',
  );
  console.log('Fallos duplicados: stock intacto y una sola liberación.');
} finally {
  await bus.close();
  await closeDb();
}
