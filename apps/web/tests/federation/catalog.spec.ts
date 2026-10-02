import { expect, test, type Page } from '@playwright/test';

async function gateway(page: Page, role: string | null) {
  const product = {
    id: 'smoke',
    title: 'Palta smoke',
    description: 'Producto de prueba',
    price: 5,
    stock: 2,
    imagePath: 'smoke.png',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let products = [product];
  const writes: { method: string; origin?: string; body: string; cookie?: string }[] = [];
  await page.route('http://localhost:8000/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === '/api/auth/get-session') {
      body = role
        ? {
            user: {
              id: 'admin-smoke',
              name: 'Smoke',
              email: 'smoke@example.test',
              role,
              emailVerified: true,
              createdAt: product.createdAt,
              updatedAt: product.updatedAt,
            },
            session: {
              id: 'session-smoke',
              userId: 'admin-smoke',
              token: 'fixture',
              expiresAt: '2099-01-01T00:00:00.000Z',
              createdAt: product.createdAt,
              updatedAt: product.updatedAt,
            },
          }
        : null;
    } else if (path.startsWith('/api/products')) {
      if (request.method() !== 'GET') {
        writes.push({
          method: request.method(),
          origin: request.headers().origin,
          cookie: request.headers().cookie,
          body: request.postData() ?? '',
        });
        if (request.method() === 'DELETE') products = [];
        else if (request.method() === 'POST') products = [product];
      }
      body = request.method() === 'GET' ? { products } : { product };
    }
    await route.fulfill({
      json: body,
      headers: {
        'access-control-allow-origin': 'http://localhost:5173',
        'access-control-allow-credentials': 'true',
      },
    });
  });
  return writes;
}

test('admin carga el slice, comparte runtimes y ejecuta CRUD desde el host', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: 'smoke-cookie',
      url: 'http://localhost:8000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const writes = await gateway(page, 'admin');
  await page.goto('/admin/products');
  await expect(page.getByRole('heading', { name: 'Administración de productos' })).toBeVisible();
  await expect(page.getByText('Palta smoke', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  const identities = await page.evaluate(async () => {
    // get() reutiliza el container ya inicializado por el host.
    const entryUrl = 'http://localhost:5174/remoteEntry.js';
    const entry = await import(/* @vite-ignore */ entryUrl);
    const remote = (await entry.get('./AdminProducts'))();
    type Share = { from: string; get: () => Promise<() => Record<string, unknown>> };
    type Federation = {
      __SHARE__: Record<string, { default: Record<string, Record<string, Share>> }>;
    };
    const federation = (globalThis as unknown as { __FEDERATION__: Federation }).__FEDERATION__;
    const scope = federation.__SHARE__.mercadoya_web.default;
    const checks = {
      useState: 'react',
      createPortal: 'react-dom',
      Button: '@mercadoya/ui/components/button',
      QueryClient: '@tanstack/react-query',
    };
    return Promise.all(
      Object.entries(checks).map(async ([key, pkg]) => {
        const versions = Object.values(scope[pkg]);
        const providers = versions.filter((share) => share.from === 'mercadoya_web');
        const factory = providers.length === 1 ? await providers[0].get() : null;
        return {
          pkg,
          providers: versions.length,
          same: factory !== null && factory()[key] === remote.runtimeIdentity[key],
        };
      }),
    );
  });
  expect(identities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pkg: 'react', providers: 1, same: true }),
      expect.objectContaining({ pkg: 'react-dom', providers: 1, same: true }),
      expect.objectContaining({ pkg: '@mercadoya/ui/components/button', providers: 1, same: true }),
      expect.objectContaining({ pkg: '@tanstack/react-query', providers: 1, same: true }),
    ]),
  );
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Palta editada');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes[0]).toMatchObject({ method: 'PUT', origin: 'http://localhost:5173' });
  expect(writes[0].body).toContain('Palta editada');
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar producto', exact: true }).click();
  await expect(page.getByText('Todavía no hay productos')).toBeVisible();
  await page.getByRole('button', { name: 'Crear producto', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Palta nueva');
  await page.getByLabel('Descripción', { exact: true }).fill('Producto nuevo');
  await page.getByLabel('Precio (S/)', { exact: true }).fill('5');
  await page
    .getByLabel('Imagen', { exact: true })
    .setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Crear producto', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.map((write) => write.method)).toEqual(['PUT', 'DELETE', 'POST']);
  expect(writes.every((write) => write.origin === 'http://localhost:5173')).toBe(true);
  expect(
    writes.every((write) => write.cookie?.includes('better-auth.session_token=smoke-cookie')),
  ).toBe(true);
  expect(errors).toEqual([]);
});

for (const role of [null, 'user']) {
  test(`guard impide montar catálogo para ${role ?? 'anónimo'}`, async ({ page }) => {
    await gateway(page, role);
    const chunks: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('5174')) chunks.push(request.url());
    });
    await page.goto('/admin/products');
    await expect(
      page.getByRole('heading', {
        name: role ? 'Acceso de administración' : 'Inicia sesión para continuar',
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear producto' })).toHaveCount(0);
    // El host puede negociar shared al arrancar, pero no debe cargar el slice protegido.
    expect(chunks.filter((url) => /catalog-slice|admin-products|AdminProducts/.test(url))).toEqual(
      [],
    );
  });
}

test('fallo del remote conserva shell y muestra recuperación', async ({ page }) => {
  await gateway(page, 'admin');
  await page.route('http://localhost:5174/**', (route) => route.abort());
  await page.goto('/admin/products');
  await expect(
    page.getByRole('heading', { name: 'El catálogo de administración no está disponible' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recargar catálogo' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.goto('/catalog');
  await expect(
    page.getByRole('heading', { name: 'Encuentra algo bueno cerca.', exact: true }),
  ).toBeVisible();
});

test('buyer consulta el estado del pedido hasta confirmación', async ({ page }, testInfo) => {
  await gateway(page, 'user');
  let reads = 0;
  const orderId = 'e9ac6bbd-a36a-4ac8-9803-04cfc6e29b81';
  await page.route(`http://localhost:8000/api/orders/${orderId}`, async (route) => {
    reads++;
    await route.fulfill({
      json: {
        order: {
          id: orderId,
          productId: 'smoke',
          quantity: 1,
          buyerId: 'admin-smoke',
          status: reads > 1 ? 'confirmed' : 'pending',
          rejectionReason: null,
          createdAt: '2026-09-30T12:00:00.000Z',
          updatedAt: '2026-09-30T12:00:00.000Z',
        },
      },
    });
  });
  const eventRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/events'))
      eventRequests.push(request.url());
  });
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByText('Confirmado', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eventos', exact: true })).toHaveCount(0);
  await expect(page.getByText('Event timeline', { exact: true })).toHaveCount(0);
  expect(eventRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('order-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('order-mobile.png'), fullPage: true });
});
