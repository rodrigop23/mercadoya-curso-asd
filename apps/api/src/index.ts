import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { zValidator } from '@hono/zod-validator';
import { desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auth } from './auth.js';
import { db } from './db/index.js';
import { product } from './db/schema.js';

const uploadsDirectory = fileURLToPath(new URL('../uploads/', import.meta.url));
const maximumImageSize = 5 * 1024 * 1024;
const imageExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

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

const signUpSchema = z
  .object({
    name: z.string().min(1),
    email: z.email(),
    password: z.string().min(8).max(128),
    image: z.string().optional(),
    callbackURL: z.string().optional(),
  })
  .strict();

const signInSchema = z
  .object({
    email: z.email(),
    password: z.string().min(8).max(128),
    rememberMe: z.boolean().optional(),
    callbackURL: z.string().optional(),
  })
  .strict();

function requestWithValidatedBody(request: Request, body: unknown) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
  });
}

const app = new Hono();

app.use('/api/*', cors({ origin: 'http://localhost:5173', credentials: true }));
app.get('/uploads/*', serveStatic({ root: fileURLToPath(new URL('../', import.meta.url)) }));

app.get('/', (c) => {
  return c.text('MercadoYa API está lista.');
});

app.post('/api/auth/sign-up/email', zValidator('json', signUpSchema), (c) => {
  return auth.handler(requestWithValidatedBody(c.req.raw, c.req.valid('json')));
});

app.post('/api/auth/sign-in/email', zValidator('json', signInSchema), (c) => {
  return auth.handler(requestWithValidatedBody(c.req.raw, c.req.valid('json')));
});

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json(session);
});

app.get('/api/products', async (c) => {
  const products = await db.select().from(product).orderBy(desc(product.createdAt));
  return c.json({ products });
});

app.post('/api/products', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (session.user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
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

  const imageExtension = imageExtensions[image.type as keyof typeof imageExtensions];
  if (!imageExtension) {
    return c.json({ error: 'La imagen debe ser JPG, PNG o WebP.' }, 400);
  }

  if (image.size > maximumImageSize) {
    return c.json({ error: 'La imagen no puede superar los 5 MB.' }, 400);
  }

  const imagePath = `${randomUUID()}.${imageExtension}`;
  const absoluteImagePath = new URL(`../uploads/${imagePath}`, import.meta.url);
  let imageWasSaved = false;

  try {
    await mkdir(uploadsDirectory, { recursive: true });
    await writeFile(absoluteImagePath, Buffer.from(await image.arrayBuffer()), { flag: 'wx' });
    imageWasSaved = true;

    const [createdProduct] = await db
      .insert(product)
      .values({ ...parsedProduct.data, imagePath })
      .returning();

    return c.json({ product: createdProduct }, 201);
  } catch (error) {
    if (imageWasSaved) {
      await unlink(absoluteImagePath).catch(() => undefined);
    }

    console.error('No se pudo crear el producto:', error);
    return c.json({ error: 'No se pudo crear el producto.' }, 500);
  }
});

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3001),
  },
  (info) => {
    console.log(`MercadoYa API listening on http://localhost:${info.port}`);
  },
);
