import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { IdentityContract } from '../identity/contract.js';
import { InvalidMediaError } from '../media/contract.js';
import type { CatalogContract } from './contract.js';

const productFormSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio.').max(160),
  description: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
  price: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, 'El precio debe tener hasta dos decimales.')
    .transform(Number)
    .pipe(z.number().finite().positive().max(99_999_999.99)),
  stock: z
    .string()
    .trim()
    .regex(/^\d+$/, 'El stock debe ser un número entero no negativo.')
    .transform(Number)
    .pipe(z.number().int().min(0).max(2_147_483_647)),
});

export function createCatalogRoutes(identity: IdentityContract, catalogContract: CatalogContract) {
  const routes = new Hono();

  // Inventory supplies a shared secret. These routes are never used by the browser UI.
  routes.use('/api/internal/catalog/*', async (c, next) => {
    const token = process.env.CATALOG_INTERNAL_TOKEN;
    if (!token) return c.json({ error: 'Catalog internal token is not configured.' }, 503);
    if (c.req.header('x-catalog-internal-token') !== token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  routes.get('/api/internal/catalog/products/:id/stock', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Identificador de producto inválido.' }, 400);
    const availableStock = await catalogContract.getAvailableStock(id.data);
    return c.json({ availableStock });
  });

  routes.post('/api/internal/catalog/products/:id/adjust-stock', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Identificador de producto inválido.' }, 400);
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({
        delta: z
          .number()
          .int()
          .safe()
          .refine((value) => value !== 0),
      })
      .safeParse(body);
    if (!parsed.success)
      return c.json({ error: 'El ajuste debe ser un entero distinto de cero.' }, 400);
    return c.json(await catalogContract.adjustStock(id.data, parsed.data.delta));
  });

  routes.get('/api/catalog/health', (c) => c.json({ module: 'catalog', ok: true }));

  routes.get(
    '/uploads/*',
    serveStatic({ root: fileURLToPath(new URL('../../../', import.meta.url)) }),
  );

  routes.get('/api/products', async (c) => {
    const products = await catalogContract.listProducts();
    return c.json({ products });
  });

  routes.post('/api/products', async (c) => {
    const authorization = await identity.requireAdmin(c.req.raw.headers);

    if (!authorization.allowed) {
      return c.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        authorization.status,
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: 'El formulario debe usar multipart/form-data.' }, 400);
    }

    const parsedProduct = productFormSchema.safeParse({
      title: formData.get('title'),
      description: formData.get('description'),
      price: formData.get('price'),
      stock: formData.get('stock'),
    });

    if (!parsedProduct.success) {
      return c.json(
        {
          error: 'Revisa los datos del producto.',
          details: parsedProduct.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const image = formData.get('image');
    if (!(image instanceof File)) {
      return c.json({ error: 'Debes seleccionar una imagen.' }, 400);
    }

    try {
      const product = await catalogContract.createProduct({ ...parsedProduct.data, image });
      return c.json({ product }, 201);
    } catch (error) {
      if (error instanceof InvalidMediaError) {
        return c.json({ error: error.message }, 400);
      }

      console.error('No se pudo crear el producto:', error);
      return c.json({ error: 'No se pudo crear el producto.' }, 500);
    }
  });

  routes.put('/api/products/:id', async (c) => {
    const authorization = await identity.requireAdmin(c.req.raw.headers);
    if (!authorization.allowed) {
      return c.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        authorization.status,
      );
    }

    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Identificador de producto inválido.' }, 400);

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: 'El formulario debe usar multipart/form-data.' }, 400);
    }

    const parsedProduct = productFormSchema.safeParse({
      title: formData.get('title'),
      description: formData.get('description'),
      price: formData.get('price'),
      stock: formData.get('stock'),
    });
    if (!parsedProduct.success) {
      return c.json(
        {
          error: 'Revisa los datos del producto.',
          details: parsedProduct.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const image = formData.get('image');
    if (image !== null && !(image instanceof File)) {
      return c.json({ error: 'La imagen no es válida.' }, 400);
    }

    try {
      const product = await catalogContract.updateProduct(id.data, {
        ...parsedProduct.data,
        ...(image ? { image } : {}),
      });
      if (!product) return c.json({ error: 'Producto no encontrado.' }, 404);
      return c.json({ product });
    } catch (error) {
      if (error instanceof InvalidMediaError) return c.json({ error: error.message }, 400);
      console.error('No se pudo actualizar el producto:', error);
      return c.json({ error: 'No se pudo actualizar el producto.' }, 500);
    }
  });

  routes.delete('/api/products/:id', async (c) => {
    const authorization = await identity.requireAdmin(c.req.raw.headers);
    if (!authorization.allowed) {
      return c.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        authorization.status,
      );
    }

    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Identificador de producto inválido.' }, 400);

    try {
      const deleted = await catalogContract.deleteProduct(id.data);
      if (!deleted) return c.json({ error: 'Producto no encontrado.' }, 404);
      return c.body(null, 204);
    } catch (error) {
      console.error('No se pudo eliminar el producto:', error);
      return c.json({ error: 'No se pudo eliminar el producto.' }, 500);
    }
  });

  return routes;
}
