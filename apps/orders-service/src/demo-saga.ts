import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { eventSubjects, paymentFailedEventSchema } from '@mercadoya/contracts';
import { createEventBus } from './events/event-bus.js';
import { closeDb } from './db/index.js';
import { createOrdersService } from './orders/service.js';

// CLI interno de clase: usa la persistencia de Orders y observa NATS antes de publicar.
const origin = process.env.CATALOG_URL || 'http://localhost:3001';
const ordersOrigin = process.env.ORDERS_SERVICE_URL || 'http://localhost:3002';
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
    const { order } = await service.createOrder({
      productId: productId!,
      quantity,
      buyerId: null,
      paymentMode: mode,
    });
    const deadline = Date.now() + 15000;
    let finished = false;
    while (Date.now() < deadline) {
      const result = await read(`/api/orders/${order.id}`, ordersOrigin);
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
