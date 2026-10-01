import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createOrderSchema,
  orderResponseSchema,
  signUpSchema,
  signInSchema,
  identitySessionResponseSchema,
  sessionBuyerSchema,
  productFormSchema,
  productResponseSchema,
  stockResponseSchema,
  stockAdjustmentSchema,
  stockAdjustmentResponseSchema,
} from '@mercadoya/contracts';

const id = '4e7a4b1b-e14d-4cd1-9dc9-55e70dbd0cb0';
const date = '2026-09-30T12:00:00.000Z';

test('Orders mantiene límites HTTP y descarta el override de la demo', () => {
  assert.deepEqual(createOrderSchema.parse({ productId: id, quantity: 1, paymentMode: 'fail' }), {
    productId: id,
    quantity: 1,
  });
  assert.equal(createOrderSchema.safeParse({ productId: id, quantity: 2147483647 }).success, true);
  for (const quantity of [0, 1.5, '1', 2147483648]) {
    assert.equal(createOrderSchema.safeParse({ productId: id, quantity }).success, false);
  }
  const order = {
    id,
    productId: id,
    quantity: 1,
    buyerId: 'buyer',
    rejectionReason: null,
    createdAt: date,
    updatedAt: date,
  };
  for (const status of ['pending', 'confirmed', 'rejected'])
    assert.equal(orderResponseSchema.safeParse({ order: { ...order, status } }).success, true);
  assert.equal(
    orderResponseSchema.safeParse({ order: { ...order, status: 'paid' } }).success,
    false,
  );
  assert.equal(
    orderResponseSchema.safeParse({
      order: { ...order, status: 'pending', createdAt: new Date(date) },
    }).success,
    false,
  );
});

test('Identity conserva validación estricta y sesión JSON extensible del proveedor', () => {
  const credentials = { email: 'buyer@example.com', password: 'password123' };
  assert.equal(signUpSchema.safeParse({ ...credentials, name: 'Buyer' }).success, true);
  for (const schema of [signUpSchema, signInSchema]) {
    const base = schema === signUpSchema ? { ...credentials, name: 'Buyer' } : credentials;
    for (const extra of [
      { password: 'short' },
      { password: 'x'.repeat(129) },
      { email: 'invalid' },
      { role: 'admin' },
    ])
      assert.equal(schema.safeParse({ ...base, ...extra }).success, false);
  }
  const session = {
    user: {
      id: 'buyer',
      name: 'Buyer',
      email: credentials.email,
      emailVerified: false,
      createdAt: date,
      updatedAt: date,
      role: 'user',
      pluginField: 'kept',
    },
    session: {
      id: 'session',
      userId: 'buyer',
      token: 'opaque',
      expiresAt: date,
      createdAt: date,
      updatedAt: date,
    },
  };
  assert.deepEqual(identitySessionResponseSchema.parse(session), session);
  assert.deepEqual(sessionBuyerSchema.parse(session), { user: { id: 'buyer' } });
  assert.equal(
    identitySessionResponseSchema.safeParse({
      ...session,
      session: { ...session.session, expiresAt: new Date(date) },
    }).success,
    false,
  );
});

test('Catalog transforma multipart y rechaza precios/stock fuera del rango actual', () => {
  const input = {
    title: ' Product ',
    description: ' Description ',
    price: ' 10.50 ',
    stock: ' 2 ',
  };
  assert.deepEqual(productFormSchema.parse(input), {
    title: 'Product',
    description: 'Description',
    price: 10.5,
    stock: 2,
  });
  for (const invalid of [
    { title: ' ' },
    { description: ' ' },
    { price: '0' },
    { price: '1.99' },
    { price: '1000000.00' },
    { price: '100000000.00' },
    { price: '1.234' },
    { price: 10 },
    { stock: '2147483648' },
    { stock: '-1' },
    { stock: '1.5' },
  ])
    assert.equal(productFormSchema.safeParse({ ...input, ...invalid }).success, false);
  assert.equal(
    productFormSchema.safeParse({ ...input, price: '999999.99', stock: '2147483647' }).success,
    true,
  );
  assert.equal(
    productResponseSchema.safeParse({
      product: {
        id,
        title: 'Product',
        description: 'Description',
        price: 10.5,
        stock: 2,
        imagePath: '/uploads/example-full.webp',
        createdAt: date,
        updatedAt: date,
      },
    }).success,
    true,
  );
});

test('el borde de stock conserva null y los rechazos de negocio con HTTP 200', () => {
  assert.deepEqual(stockResponseSchema.parse({ availableStock: null }), { availableStock: null });
  for (const delta of [-2, 2, Number.MAX_SAFE_INTEGER])
    assert.equal(stockAdjustmentSchema.safeParse({ delta }).success, true);
  for (const delta of [0, 1.5, '2', Number.MAX_SAFE_INTEGER + 1])
    assert.equal(stockAdjustmentSchema.safeParse({ delta }).success, false);
  assert.equal(
    stockAdjustmentResponseSchema.safeParse({ adjusted: true, availableStock: 0 }).success,
    true,
  );
  assert.equal(
    stockAdjustmentResponseSchema.safeParse({ adjusted: true, availableStock: null }).success,
    false,
  );
  for (const reason of ['product_not_found', 'insufficient_stock', 'stock_limit'])
    assert.equal(
      stockAdjustmentResponseSchema.safeParse({ adjusted: false, reason }).success,
      true,
    );
  assert.equal(
    stockAdjustmentResponseSchema.safeParse({ adjusted: false, reason: 'unknown' }).success,
    false,
  );
});

test('las respuestas de login usan token opaco y logout admite metadata del proveedor', async () => {
  const {
    signUpResponseSchema,
    signInResponseSchema,
    signOutResponseSchema,
    authErrorResponseSchema,
  } = await import('@mercadoya/contracts');
  const user = {
    id: 'buyer',
    name: 'Buyer',
    email: 'buyer@example.com',
    emailVerified: false,
    createdAt: date,
    updatedAt: date,
  };
  assert.equal(signUpResponseSchema.safeParse({ user, token: null }).success, true);
  assert.equal(
    signInResponseSchema.safeParse({ user, token: 'opaque', redirect: false }).success,
    true,
  );
  assert.equal(
    signInResponseSchema.safeParse({ user, token: null, redirect: false }).success,
    false,
  );
  assert.deepEqual(signOutResponseSchema.parse({ success: true, redirect: false }), {
    success: true,
    redirect: false,
  });
  assert.equal(
    authErrorResponseSchema.safeParse({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    }).success,
    true,
  );
});
