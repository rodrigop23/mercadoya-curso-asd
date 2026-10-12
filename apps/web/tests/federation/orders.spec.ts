import { expect, test, type Page } from '@playwright/test';
import type { Order } from '../../src/lib/orders';
import { rejectionReasons } from '../../src/lib/order-status';

const timestamp = '2026-10-03T12:00:00.000Z';
const productId = 'd1d1392e-c696-4ac9-957f-57354bb3c200';
const orderIds = [
  'e9ac6bbd-a36a-4ac8-9803-04cfc6e29b81',
  '26600c9b-41ac-427a-a0ae-61e06a4d6c69',
  'b5f0dd8c-f544-477b-8f70-4ec3a0e13527',
  '62188607-28f8-48f2-89c4-4a444f33bcce',
  'ebed7bc8-4b31-499d-a8b5-6cabd3f3b4c5',
];
const ordersFixture: Order[] = orderIds.map((id, index) => ({
  id,
  productId,
  quantity: 2,
  buyerId: 'buyer-a',
  status: (['confirmed', 'pending', 'rejected', 'cancelled', 'expired'] as const)[index]!,
  rejectionReason:
    index === 2
      ? 'insufficient_stock'
      : index === 3
        ? 'order_cancelled'
        : index === 4
          ? 'order_expired'
          : null,
  createdAt: new Date(Date.parse(timestamp) - index * 86400000).toISOString(),
  updatedAt: timestamp,
  items:
    index === 2
      ? null
      : [
          {
            productId,
            quantity: 2,
            title: 'Palta fresca',
            thumbnailPath: null,
            unitAmount: 1025,
            currency: 'pen',
          },
        ],
  totalAmount: index === 2 ? null : 2050,
  currency: index === 2 ? null : 'pen',
}));

async function gateway(page: Page, initialBuyer: string | null = 'buyer-a') {
  const state = {
    buyer: initialBuyer,
    orders: structuredClone(ordersFixture),
    status: 200,
    cancellations: 0,
    reads: [] as { buyer: string | null; method: string; cookie?: string }[],
  };
  const user = () => ({
    id: state.buyer,
    name: 'Comprador',
    email: `${state.buyer}@example.test`,
    role: 'user',
    emailVerified: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await page.route('http://localhost:8000/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path === '/api/auth/sign-out') {
      state.buyer = null;
      body = { success: true };
    } else if (path === '/api/auth/sign-in/email') {
      state.buyer = 'buyer-b';
      body = { token: 'fixture', redirect: false, user: user() };
    } else if (path === '/api/auth/get-session') {
      body = state.buyer
        ? {
            user: user(),
            session: {
              id: 'history-session',
              userId: state.buyer,
              token: 'fixture',
              expiresAt: '2099-01-01T00:00:00.000Z',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          }
        : null;
    } else if (path === '/api/products') body = { products: [] };
    else if (path === '/api/orders') {
      state.reads.push({
        buyer: state.buyer,
        method: request.method(),
        cookie: request.headers().cookie,
      });
      status = state.status;
      body =
        status === 200
          ? { orders: state.orders }
          : { error: 'No se pudieron consultar tus pedidos.' };
    } else if (path.endsWith('/cancel')) {
      state.cancellations++;
      const order = state.orders.find((order) => order.id === path.split('/').at(-2))!;
      order.status = 'cancelled';
      order.rejectionReason = 'order_cancelled';
      body = { order };
      status = 202;
    } else if (path.endsWith('/checkout')) body = { provider: 'polar', checkout: null };
    else if (path.startsWith('/api/orders/')) {
      const order = state.orders.find((order) => order.id === path.split('/').at(-1));
      status = order ? 200 : 404;
      body = order ? { order } : { error: 'El pedido no existe.' };
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
  return state;
}

test('avatar abre el historial con estados, orden recibido y enlaces a la página existente', async ({
  page,
}, testInfo) => {
  const state = await gateway(page);
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: 'history-fixture',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Abrir el menú de cuenta de Comprador' }).click();
  await page.getByRole('menuitem', { name: 'Mis pedidos' }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Mis pedidos' })).toBeVisible();
  const links = page.getByRole('list', { name: 'Historial de pedidos' }).getByRole('link');
  await expect(links).toHaveCount(5);
  for (const [index, id] of orderIds.entries())
    await expect(links.nth(index)).toHaveAttribute('href', `/orders/${id}`);
  for (const status of ['Confirmado', 'Pendiente', 'Rechazado', 'Cancelado', 'Vencido'])
    await expect(page.getByText(status, { exact: true })).toBeVisible();
  await expect(page.getByText('Importe no disponible')).toBeVisible();
  expect(
    state.reads.every(
      (read) =>
        read.method === 'GET' && read.cookie?.includes('better-auth.session_token=history-fixture'),
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('orders-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('orders-mobile.png'), fullPage: true });
  await links.first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/orders/${orderIds[0]}$`));
  await expect(page.getByRole('heading', { name: 'Estado del pedido' })).toBeVisible();
  await expect(page.getByText('Confirmado', { exact: true })).toBeVisible();
});

test('visitante no consulta el historial y dispone de acceso al login', async ({ page }) => {
  const state = await gateway(page, null);
  await page.goto('/orders');
  await expect(page.getByText('Inicia sesión para ver tus pedidos', { exact: true })).toBeVisible();
  expect(state.reads).toEqual([]);
  await expect(page.locator('main').getByRole('link', { name: 'Ingresar' })).toHaveAttribute(
    'href',
    '/login',
  );
  await page.getByRole('button', { name: 'Cuenta', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Mis pedidos' })).toHaveCount(0);
});

test('historial vacío ofrece catálogo y sesión expirada ofrece login sin reintentos', async ({
  page,
}) => {
  const state = await gateway(page);
  state.orders = [];
  await page.goto('/orders');
  await expect(page.getByText('Todavía no tienes pedidos')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explorar el catálogo' })).toHaveAttribute(
    'href',
    '/catalog',
  );
  state.status = 401;
  state.reads = [];
  await page.reload();
  await expect(page.getByText('Inicia sesión para ver tus pedidos', { exact: true })).toBeVisible();
  expect(state.reads).toHaveLength(1);
});

test('fallo del historial permite reintentar y recuperar los pedidos', async ({ page }) => {
  const state = await gateway(page);
  state.status = 500;
  await page.goto('/orders');
  await expect(page.getByRole('alert')).toContainText('No se pudieron cargar tus pedidos');
  state.status = 200;
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Historial de pedidos' }).getByRole('link'),
  ).toHaveCount(5);
});

test('cerrar sesión oculta el historial y otra cuenta obtiene su propia consulta', async ({
  page,
}) => {
  const state = await gateway(page);
  await page.goto('/orders');
  await expect(page.getByRole('list', { name: 'Historial de pedidos' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir el menú de cuenta de Comprador' }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page.getByText('Inicia sesión para ver tus pedidos', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Historial de pedidos' })).toHaveCount(0);
  state.orders = [];
  await page.locator('main').getByRole('link', { name: 'Ingresar' }).click();
  await page.getByLabel('Correo electrónico').fill('buyer-b@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir el menú de cuenta de Comprador' }).click();
  await page.getByRole('menuitem', { name: 'Mis pedidos' }).click();
  await expect(page.getByText('Todavía no tienes pedidos')).toBeVisible();
  expect(state.reads.map((read) => read.buyer)).toContain('buyer-b');
  await expect(page.getByText(`Pedido #${orderIds[0]!.slice(0, 8)}`)).toHaveCount(0);
});

test('solo pending permite cancelar y el detalle explica cancelación y vencimiento', async ({
  page,
}, testInfo) => {
  const state = await gateway(page);
  for (const order of state.orders) {
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByRole('heading', { name: 'Estado del pedido' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar pedido', exact: true })).toHaveCount(
      order.status === 'pending' ? 1 : 0,
    );
    if (order.status === 'cancelled' || order.status === 'expired') {
      await expect(
        page.getByText(order.status === 'cancelled' ? 'Cancelado' : 'Vencido', { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('status')).toContainText(
        rejectionReasons[order.rejectionReason!]!,
      );
    }
  }
  await page.screenshot({ path: testInfo.outputPath('order-expired-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('order-expired-mobile.png'), fullPage: true });
  await page.goto(`/orders/${orderIds[1]}`);
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, cancelar pedido' }).click();
  await expect(page.getByText('Cancelado', { exact: true })).toBeVisible();
  expect(state.cancellations).toBe(1);
});

test('reasons de cierre explican devolución de stock y permiten reintentar', () => {
  expect(rejectionReasons.order_cancelled).toContain('Cancelaste el pedido');
  expect(rejectionReasons.order_expired).toContain('El plazo para pagar terminó');
  for (const reason of ['order_cancelled', 'order_expired']) {
    expect(rejectionReasons[reason]).toContain('devolviendo las unidades al stock');
    expect(rejectionReasons[reason]).toContain('volver a comprar');
  }
});
