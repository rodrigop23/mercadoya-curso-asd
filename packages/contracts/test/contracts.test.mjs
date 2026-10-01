import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  eventSubjects,
  orderPlacedEventSchema,
  inventoryReservedEventSchema,
  inventoryRejectedEventSchema,
  inventoryReleasedEventSchema,
  paymentSucceededEventSchema,
  paymentFailedEventSchema,
  reservationResponseSchema,
} from '@mercadoya/contracts';

const event = {
  version: 1,
  orderId: 'e9ac6bbd-a36a-4ac8-9803-04cfc6e29b81',
  productId: '4e7a4b1b-e14d-4cd1-9dc9-55e70dbd0cb0',
  quantity: 2,
  buyerId: null,
  occurredAt: '2026-09-29T12:00:00.000Z',
};

const schemas = [
  ['orders.placed', orderPlacedEventSchema, {}],
  ['inventory.reserved', inventoryReservedEventSchema, {}],
  ['inventory.rejected', inventoryRejectedEventSchema, { reason: 'insufficient_stock' }],
  ['inventory.released', inventoryReleasedEventSchema, {}],
  ['payment.succeeded', paymentSucceededEventSchema, {}],
  ['payment.failed', paymentFailedEventSchema, { reason: 'simulated_payment_failure' }],
];

test('los subjects v1 conservan los nombres publicados', () => {
  assert.deepEqual(eventSubjects, {
    ordersPlaced: 'orders.placed',
    inventoryReserved: 'inventory.reserved',
    inventoryRejected: 'inventory.rejected',
    inventoryReleased: 'inventory.released',
    paymentSucceeded: 'payment.succeeded',
    paymentFailed: 'payment.failed',
  });
});

for (const [subject, schema, extra] of schemas) {
  test(`${subject} acepta un evento v1 serializado y un comprador identificado`, () => {
    const input = { ...event, ...extra };
    assert.deepEqual(schema.parse(JSON.parse(JSON.stringify(input))), input);
    assert.equal(schema.parse({ ...input, buyerId: 'buyer-1' }).buyerId, 'buyer-1');
  });

  test(`${subject} rechaza versiones, cantidades, IDs y fechas inválidos`, () => {
    for (const invalid of [
      { version: 2 },
      { quantity: 0 },
      { quantity: -1 },
      { quantity: 1.5 },
      { quantity: '2' },
      { orderId: 'not-a-uuid' },
      { productId: 'not-a-uuid' },
      { occurredAt: 'yesterday' },
      { buyerId: undefined },
    ]) {
      assert.equal(
        schema.safeParse({ ...event, ...extra, ...invalid }).success,
        false,
        `${subject}: ${JSON.stringify(invalid)}`,
      );
    }
  });
}

test('Inventory rejected exige una causa conocida', () => {
  for (const reason of [
    'invalid_quantity',
    'product_not_found',
    'insufficient_stock',
    'stock_limit',
  ]) {
    assert.equal(inventoryRejectedEventSchema.parse({ ...event, reason }).reason, reason);
  }
  for (const reason of [undefined, '', 'unknown_reason']) {
    assert.equal(inventoryRejectedEventSchema.safeParse({ ...event, reason }).success, false);
  }
});

test('Payment failed exige una causa de entre 1 y 160 caracteres', () => {
  for (const reason of ['x', 'x'.repeat(160)]) {
    assert.equal(paymentFailedEventSchema.parse({ ...event, reason }).reason, reason);
  }
  for (const reason of [undefined, '', 'x'.repeat(161)]) {
    assert.equal(paymentFailedEventSchema.safeParse({ ...event, reason }).success, false);
  }
});

test('correlación Polar es aditiva en v1 y sobrevive a inventory.released', () => {
  const correlation = {
    provider: 'polar',
    eventId: 'delivery-id',
    checkoutId: event.orderId,
    providerOrderId: event.productId,
  };
  for (const schema of [
    paymentSucceededEventSchema,
    paymentFailedEventSchema,
    inventoryReleasedEventSchema,
  ]) {
    const input = { ...event, ...correlation, reason: 'polar_checkout_expired' };
    assert.equal(schema.parse(input).version, 1);
    for (const [key, value] of Object.entries(correlation))
      assert.equal(schema.parse(input)[key], value);
    assert.equal(schema.safeParse({ ...input, checkoutId: 'invalid' }).success, false);
  }
});

test('la respuesta HTTP exige status reserved', () => {
  const reservation = {
    id: '8cdacbbd-a36a-4ac8-9803-04cfc6e29b81',
    orderId: event.orderId,
    productId: event.productId,
    quantity: event.quantity,
    createdAt: event.occurredAt,
  };
  assert.equal(reservationResponseSchema.safeParse({ reservation }).success, false);
  const response = { reservation: { ...reservation, status: 'reserved' } };
  assert.deepEqual(reservationResponseSchema.parse(response), response);
  assert.equal(
    reservationResponseSchema.safeParse({
      reservation: { ...reservation, status: 'released' },
    }).success,
    false,
  );
  assert.equal(
    reservationResponseSchema.safeParse({
      reservation: { ...response.reservation, orderId: 'invalid' },
    }).success,
    false,
  );
});
