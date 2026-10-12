import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  createOrderSchema,
  stockBatchSchema,
  orderPlacedEventSchema,
  inventoryReservedEventSchema,
  paymentSucceededEventSchema,
  paymentFailedEventSchema,
  inventoryReleasedEventSchema,
} from '@mercadoya/contracts';

const items = [
  { productId: randomUUID(), quantity: 2 },
  { productId: randomUUID(), quantity: 3 },
];
test('carrito acepta líneas y descarta importes del navegador; mantiene compra de un producto', () => {
  assert.deepEqual(
    createOrderSchema.parse({
      items: items.map((item) => ({ ...item, unitAmount: 1 })),
      total: 1,
      currency: 'usd',
    }),
    { items },
  );
  assert.deepEqual(createOrderSchema.parse(items[0]), items[0]);
  for (const invalid of [
    [],
    [items[0], items[0]],
    [{ ...items[0], quantity: 0 }],
    [{ ...items[0], quantity: 1.5 }],
    Array.from({ length: 21 }, () => ({ productId: randomUUID(), quantity: 1 })),
  ])
    assert.equal(createOrderSchema.safeParse({ items: invalid }).success, false);
});
test('todas las fases de la saga conservan las líneas sin cambiar subjects v1', () => {
  const event = {
    version: 1,
    orderId: randomUUID(),
    ...items[0],
    items,
    buyerId: 'buyer',
    occurredAt: new Date().toISOString(),
    reason: 'polar_checkout_expired',
  };
  for (const schema of [
    orderPlacedEventSchema,
    inventoryReservedEventSchema,
    paymentSucceededEventSchema,
    paymentFailedEventSchema,
    inventoryReleasedEventSchema,
  ])
    assert.deepEqual(schema.parse(event).items, items);
});
test('ajuste atómico exige una clave y productos distintos con deltas válidos', () => {
  const adjustments = items.map((item) => ({ productId: item.productId, delta: -item.quantity }));
  assert.equal(
    stockBatchSchema.safeParse({ operationId: 'reserve:order', adjustments }).success,
    true,
  );
  for (const invalid of [
    [],
    [adjustments[0], adjustments[0]],
    [{ ...adjustments[0], delta: 0 }],
    [{ ...adjustments[0], delta: 2_147_483_648 }],
  ])
    assert.equal(
      stockBatchSchema.safeParse({ operationId: 'reserve:order', adjustments: invalid }).success,
      false,
    );
});
