import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { paymentCheckoutResponseSchema, reservationResponseV2Schema } from '@mercadoya/contracts';
import { paymentProvider } from './payment/config.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
paymentProvider();
assert.equal(process.env.POLAR_SERVER || 'sandbox', 'sandbox', 'La demo requiere Polar sandbox.');
const origin = process.env.CATALOG_URL || 'http://localhost:3007';
const gateway = process.env.GATEWAY_URL || 'http://localhost:8000';
const token = process.env.CATALOG_INTERNAL_TOKEN;
assert(token, 'Configura CATALOG_INTERNAL_TOKEN en .env.');
const signup = await fetch(new URL('/api/auth/sign-up/email', gateway), {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
  body: JSON.stringify({
    name: 'Demo Polar',
    email: `demo-polar-${crypto.randomUUID()}@example.com`,
    password: crypto.randomUUID(),
  }),
});
assert(signup.ok, `Signup de demo: HTTP ${signup.status}`);
const cookie = signup.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .join('; ');
assert(cookie, 'Signup no devolvió cookie de sesión.');
async function read(path: string, internal = false) {
  const response = await fetch(new URL(path, internal ? origin : gateway), {
    headers: internal ? { 'x-catalog-internal-token': token! } : { cookie },
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok, `HTTP ${response.status} al consultar ${path}`);
  return response.json();
}
const { products } = (await read('/api/products', true)) as {
  products: { id: string; stock: number }[];
};
const productId = process.env.DEMO_PRODUCT_ID ?? products.find((p) => p.stock >= 1)?.id;
assert(productId, 'Crea un producto sincronizado con stock o define DEMO_PRODUCT_ID.');
const stock = async () =>
  (await read(`/api/internal/catalog/products/${productId}/stock`, true)).availableStock as number;
const before = await stock();
assert(before >= 1 && before < 2_147_483_647, 'La demo requiere stock entre 1 y 2147483646.');
async function create(quantity: number): Promise<{ id: string }> {
  const response = await fetch(new URL('/api/orders', gateway), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:5173' },
    body: JSON.stringify({ productId, quantity }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 202, `Compra: ${await response.clone().text()}`);
  return (await response.json()).order;
}
async function waitFor<T>(
  readValue: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout: number,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await readValue();
    if (ready(value)) return value;
    await delay(500);
  }
  throw new Error('Timeout esperando el desenlace. Consulta el pedido y los logs de Orders.');
}
const rejected = await create(before + 1);
await waitFor(
  () => read(`/api/orders/${rejected.id}`),
  (data) => data.order.status === 'rejected',
  15000,
);
assert.equal(await stock(), before, 'El rechazo por stock modificó las existencias.');
const rejectedCheckout = paymentCheckoutResponseSchema.parse(
  await read(`/api/orders/${rejected.id}/checkout`),
);
assert.equal(rejectedCheckout.checkout, null);
console.log(`Stock insuficiente: ${rejected.id}, rejected, stock ${before}.`);

const order = await create(1);
const data = await waitFor(
  async () => paymentCheckoutResponseSchema.parse(await read(`/api/orders/${order.id}/checkout`)),
  (result) => result.checkout !== null,
  30000,
);
assert(data.checkout);
console.log(`Pedido: ${order.id}. Abre este checkout Polar sandbox y completa el pago:`);
console.log(data.checkout.url);
console.log('Esperando hasta 10 minutos el webhook firmado de Polar.');
const result = await waitFor(
  () => read(`/api/orders/${order.id}`),
  (value) => value.order.status !== 'pending',
  600000,
);
if (result.order.status === 'confirmed') {
  assert.equal(await stock(), before - 1);
  const reservation = reservationResponseV2Schema.parse(
    await read(`/api/inventory/v2/reservations/${order.id}`),
  );
  assert.equal(reservation.reservation.orderId, order.id);
  console.log(`Cobro Polar confirmado: ${order.id}, stock ${before - 1}.`);
} else {
  await waitFor(stock, (value) => value === before, 15000);
  console.log(
    `Pago rechazado: ${order.id}, ${result.order.rejectionReason}, stock restaurado ${before}.`,
  );
}
