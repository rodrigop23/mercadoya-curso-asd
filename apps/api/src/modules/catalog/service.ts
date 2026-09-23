import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { desc } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { product } from './schema.js';
import type { CatalogContract, CreateProductInput } from './contract.js';

const uploadsDirectory = fileURLToPath(new URL('../../../uploads/', import.meta.url));

export const catalogContract: CatalogContract = {
  async listProducts() {
    return db.select().from(product).orderBy(desc(product.createdAt));
  },

  async createProduct(input: CreateProductInput) {
    const extensionByMimeType = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    } as const;
    const extension = extensionByMimeType[input.image.type as keyof typeof extensionByMimeType];

    if (!extension) {
      throw new Error('La imagen debe ser JPG, PNG o WebP.');
    }

    const imagePath = `${randomUUID()}.${extension}`;
    const absoluteImagePath = new URL(`../../../uploads/${imagePath}`, import.meta.url);
    let imageWasSaved = false;

    try {
      await mkdir(uploadsDirectory, { recursive: true });
      await writeFile(absoluteImagePath, Buffer.from(await input.image.arrayBuffer()), {
        flag: 'wx',
      });
      imageWasSaved = true;

      const [createdProduct] = await db
        .insert(product)
        .values({
          title: input.title,
          description: input.description,
          price: input.price,
          stock: input.stock,
          imagePath,
        })
        .returning();

      return createdProduct;
    } catch (error) {
      if (imageWasSaved) {
        await unlink(absoluteImagePath).catch(() => undefined);
      }

      throw error;
    }
  },
};
