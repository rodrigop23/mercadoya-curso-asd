import { expect, test, type Page } from '@playwright/test';

const timestamp = '2026-10-02T12:00:00.000Z';
const productsFixture = [
  {
    id: 'd1d1392e-c696-4ac9-957f-57354bb3c200',
    title: 'Palta fresca',
    description: 'Palta del mercado local.',
    price: 10.25,
    stock: 3,
    imagePath: 'media/palta-full.webp',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: '26600c9b-41ac-427a-a0ae-61e06a4d6c69',
    title: 'Tomate de temporada',
    description: 'Tomates para tu cocina.',
    price: 7,
    stock: 5,
    imagePath: 'media/tomate-full.webp',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

async function gateway(page: Page, initialBuyer: string | null = 'cart-buyer') {
  const state = {
    buyer: initialBuyer,
    products: structuredClone(productsFixture),
    writes: [] as { items: { productId: string; quantity: number }[]; idempotencyKey: string }[],
    order: null as Record<string, unknown> | null,
    status: 'pending',
    failNext: false,
    images: [] as string[],
  };
  await page.route('http://localhost:8000/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path === '/api/auth/get-session')
      body = state.buyer
        ? {
            user: {
              id: state.buyer,
              name: 'Comprador',
              email: 'buyer@example.test',
              role: 'user',
              emailVerified: true,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            session: {
              id: 'cart-session',
              userId: state.buyer,
              token: 'fixture',
              expiresAt: '2099-01-01T00:00:00.000Z',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          }
        : null;
    else if (path === '/api/products') body = { products: state.products };
    else if (path.startsWith('/uploads/')) {
      state.images.push(path);
      const color = path.includes('palta') ? '#537848' : '#c75343';
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${color}"/></svg>`,
        headers: { 'access-control-allow-origin': '*' },
      });
      return;
    } else if (path === '/api/orders' && request.method() === 'POST') {
      const input = request.postDataJSON();
      state.writes.push(input);
      if (state.failNext) {
        state.failNext = false;
        status = 503;
        body = { error: 'No se pudo crear el pedido. Reintenta el pago.' };
      } else {
        // GET puede adelantarse al POST; onSuccess debe aportar el pedido al caché.
        await new Promise((resolve) => setTimeout(resolve, 120));
        const items = input.items.map((item: { productId: string; quantity: number }) => {
          const product = state.products.find((product) => product.id === item.productId)!;
          return {
            ...item,
            title: product.title,
            thumbnailPath: product.imagePath.replace('-full.', '-thumb.'),
            unitAmount: Math.round(product.price * 100),
            currency: 'pen',
          };
        });
        state.order ??= {
          id: input.idempotencyKey,
          productId: items[0].productId,
          quantity: items[0].quantity,
          buyerId: state.buyer,
          items,
          totalAmount: items.reduce(
            (sum: number, item: { unitAmount: number; quantity: number }) =>
              sum + item.unitAmount * item.quantity,
            0,
          ),
          currency: 'pen',
          rejectionReason: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        body = { order: { ...state.order, status: state.status } };
        status = 202;
      }
    } else if (path.endsWith('/checkout'))
      body = {
        provider: 'polar',
        checkout: state.order
          ? {
              id: 'e0993cf4-d7c9-4d90-b2cb-489303881129',
              url: 'https://sandbox.polar.sh/checkout/cart-test',
              expiresAt: '2099-01-01T00:00:00.000Z',
              amount: state.order.totalAmount,
              currency: 'pen',
            }
          : null,
      };
    else if (path.startsWith('/api/orders/')) {
      if (state.order) body = { order: { ...state.order, status: state.status } };
      else {
        status = 404;
        body = { error: 'El pedido no existe.' };
      }
    }
    await route.fulfill({
      status,
      json: body,
      headers: {
        'access-control-allow-origin': 'http://localhost:5173',
        'access-control-allow-credentials': 'true',
      },
    });
  });
  await page.route('https://sandbox.polar.sh/checkout/cart-test', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<html lang="es"><body><h1>Pago de prueba</h1><p>Palta fresca y Tomate de temporada</p><a href="http://localhost:5173/orders/${state.order?.id}?checkout_id=e0993cf4-d7c9-4d90-b2cb-489303881129">Confirmar pago de prueba</a><a href="http://localhost:5173/cart">Volver al carrito</a></body></html>`,
    });
  });
  return state;
}

async function addProducts(page: Page) {
  await page.goto('/catalog');
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Palta fresca' }) })
    .getByRole('button', { name: 'Agregar al carrito', exact: true })
    .click();
  await page.getByRole('button', { name: 'Agregar una unidad de Palta fresca' }).click();
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Tomate de temporada' }) })
    .getByRole('button', { name: 'Agregar al carrito', exact: true })
    .click();
}

async function captureReview(
  page: Page,
  testInfo: import('@playwright/test').TestInfo,
  name: string,
) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: false });
  if (await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)) {
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    await page.screenshot({
      path: testInfo.outputPath(name.replace('.png', '-bottom.png')),
      fullPage: false,
    });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('catálogo usa texto fijo, papelera a 1, menos desde 2 y respeta stock sin crear pedidos', async ({
  page,
}, testInfo) => {
  const state = await gateway(page);
  await page.goto('/catalog');
  const palta = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Palta fresca' }) });
  await expect(palta.locator('input')).toHaveCount(0);
  const addButton = palta.getByRole('button', { name: 'Agregar al carrito', exact: true });
  await expect(addButton).toBeVisible();
  await expect(addButton).toBeEnabled();
  const addButtonBounds = await addButton.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
  await addButton.click();
  await expect(palta.getByRole('group').getByRole('button')).toHaveCount(2);
  const quantityBounds = await palta.getByRole('group').evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
  expect(quantityBounds).toEqual(addButtonBounds);
  await expect(
    palta.getByRole('button', { name: 'Eliminar Palta fresca del carrito' }),
  ).toBeVisible();
  await palta.getByRole('button', { name: 'Agregar una unidad de Palta fresca' }).click();
  await expect(
    palta.getByRole('button', { name: 'Restar una unidad de Palta fresca' }),
  ).toBeVisible();
  await expect(
    palta.getByRole('button', { name: 'Eliminar Palta fresca del carrito' }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir carrito, 2 unidades' })).toBeVisible();
  await captureReview(page, testInfo, 'catalog-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await captureReview(page, testInfo, 'catalog-mobile.png');
  await palta.getByRole('button', { name: 'Agregar una unidad de Palta fresca' }).click();
  await expect(
    palta.getByRole('button', { name: 'Agregar una unidad de Palta fresca' }),
  ).toBeDisabled();
  await palta.getByRole('button', { name: 'Restar una unidad de Palta fresca' }).click();
  await palta.getByRole('button', { name: 'Restar una unidad de Palta fresca' }).click();
  await palta.getByRole('button', { name: 'Eliminar Palta fresca del carrito' }).click();
  await expect(
    palta.getByRole('button', { name: 'Agregar al carrito', exact: true }),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('carrito suma, edita, elimina, persiste al recargar y solicita solo miniaturas', async ({
  page,
}, testInfo) => {
  const state = await gateway(page);
  await addProducts(page);
  state.images = [];
  await page.getByRole('link', { name: 'Abrir carrito, 3 unidades' }).click();
  const summary = page.getByRole('complementary', { name: 'Resumen de compra' });
  await expect(summary.getByText('S/ 27.50', { exact: true })).toBeVisible();
  await expect
    .poll(() => state.images)
    .toEqual(
      expect.arrayContaining([
        '/uploads/media/palta-thumb.webp',
        '/uploads/media/tomate-thumb.webp',
      ]),
    );
  expect(state.images.every((path) => path.includes('-thumb.'))).toBe(true);
  await expect(page.locator('main input')).toHaveCount(0);
  await captureReview(page, testInfo, 'cart-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await captureReview(page, testInfo, 'cart-mobile.png');
  await page.reload();
  await expect(summary.getByText('S/ 27.50', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar una unidad de Tomate de temporada' }).click();
  await expect(summary.getByText('S/ 34.50', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Eliminar Tomate de temporada del carrito', exact: true })
    .click();
  await expect(summary.getByText('S/ 20.50', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Eliminar Palta fresca del carrito', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Tu carrito está vacío' })).toBeVisible();
});

test('un pago con varias líneas redirige a la orden, conserva precios y thumbnails, y limpia el carrito', async ({
  page,
}, testInfo) => {
  const state = await gateway(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await addProducts(page);
  await page.getByRole('link', { name: 'Abrir carrito, 3 unidades' }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page).toHaveURL('https://sandbox.polar.sh/checkout/cart-test');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].items).toEqual([
    { productId: productsFixture[0].id, quantity: 2 },
    { productId: productsFixture[1].id, quantity: 1 },
  ]);
  state.status = 'confirmed';
  state.products[0].title = 'Palta con otro nombre';
  state.products[0].price = 30;
  state.images = [];
  await page.getByRole('link', { name: 'Confirmar pago de prueba' }).click();
  await expect(page.getByText('Confirmado', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Palta fresca' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tomate de temporada' })).toBeVisible();
  await expect(page.getByText('S/ 27.50', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir carrito, 0 unidades' })).toBeVisible();
  expect(state.images.every((path) => path.includes('-thumb.'))).toBe(true);
  await captureReview(page, testInfo, 'order-cart-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await captureReview(page, testInfo, 'order-cart-mobile.png');
  expect(errors).toEqual([]);
});

test('stock reducido y producto borrado bloquean pagar hasta corregir el carrito', async ({
  page,
}, testInfo) => {
  const state = await gateway(page);
  await addProducts(page);
  await page.getByRole('button', { name: 'Agregar una unidad de Tomate de temporada' }).click();
  state.products = [state.products[0]];
  state.products[0].stock = 1;
  await page.goto('/cart');
  await expect(
    page.getByText('Este producto ya no está disponible. Elimínalo para continuar.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pagar', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Restar una unidad de Tomate de temporada' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Agregar una unidad de Tomate de temporada' }),
  ).toBeDisabled();
  await captureReview(page, testInfo, 'cart-unavailable-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await captureReview(page, testInfo, 'cart-unavailable-mobile.png');
  await page.getByRole('button', { name: 'Restar una unidad de Palta fresca' }).click();
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Tomate de temporada' }) })
    .getByRole('button', { name: 'Eliminar Tomate de temporada del carrito' })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Pagar', exact: true })).toBeEnabled();
});

test('error incierto conserva carrito y reintenta con la misma clave de pedido', async ({
  page,
}) => {
  const state = await gateway(page);
  await addProducts(page);
  await page.getByRole('link', { name: 'Abrir carrito, 3 unidades' }).click();
  state.failNext = true;
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Reintenta el pago');
  await expect(
    page.getByRole('button', { name: 'Agregar una unidad de Palta fresca' }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Reintentar pago', exact: true }).click();
  await expect(page).toHaveURL('https://sandbox.polar.sh/checkout/cart-test');
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
});

test('carrito de invitado pasa a su cuenta y no se comparte entre compradores', async ({
  page,
}) => {
  const state = await gateway(page, null);
  await addProducts(page);
  await page.getByRole('link', { name: 'Abrir carrito, 3 unidades' }).click();
  await expect(page.getByRole('link', { name: 'Inicia sesión para pagar' })).toBeVisible();
  state.buyer = 'cart-buyer';
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pagar', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir carrito, 3 unidades' })).toBeVisible();
  state.buyer = 'another-buyer';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu carrito está vacío' })).toBeVisible();
  state.buyer = 'cart-buyer';
  await page.reload();
  await expect(page.getByRole('link', { name: 'Abrir carrito, 3 unidades' })).toBeVisible();
});

test('regresar de Polar conserva el pedido y un rechazo permite corregir las cantidades', async ({
  page,
}) => {
  const state = await gateway(page);
  await addProducts(page);
  await page.getByRole('link', { name: 'Abrir carrito, 3 unidades' }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page).toHaveURL('https://sandbox.polar.sh/checkout/cart-test');
  await page.getByRole('link', { name: 'Volver al carrito', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continuar pago' })).toBeVisible();
  await expect(page).toHaveURL('http://localhost:5173/cart');
  await expect(page.getByRole('link', { name: 'Abrir carrito, 3 unidades' })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  state.status = 'rejected';
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('El pedido no se completó');
  await expect(
    page.getByRole('button', { name: 'Restar una unidad de Palta fresca' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Restar una unidad de Palta fresca' }).click();
  await expect(page.getByRole('link', { name: 'Abrir carrito, 2 unidades' })).toBeVisible();
});
