import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { IdentityContract } from '../identity/contract.js';
import { catalogContract } from './service.js';

const maximumImageSize = 5 * 1024 * 1024;

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

export function createCatalogRoutes(identity: IdentityContract) {
  const routes = new Hono();

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
    if (!(image instanceof File) || image.size === 0) {
      return c.json({ error: 'Debes seleccionar una imagen.' }, 400);
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) {
      return c.json({ error: 'La imagen debe ser JPG, PNG o WebP.' }, 400);
    }

    if (image.size > maximumImageSize) {
      return c.json({ error: 'La imagen no puede superar los 5 MB.' }, 400);
    }

    try {
      const product = await catalogContract.createProduct({ ...parsedProduct.data, image });
      return c.json({ product }, 201);
    } catch (error) {
      console.error('No se pudo crear el producto:', error);
      return c.json({ error: 'No se pudo crear el producto.' }, 500);
    }
  });

  return routes;
}
