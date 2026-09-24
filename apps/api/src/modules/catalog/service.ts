import { desc } from 'drizzle-orm';

import { db } from '../../db/index.js';
import type { MediaContract } from '../media/contract.js';
import { product } from './schema.js';
import type { CatalogContract, CreateProductInput } from './contract.js';

export function createCatalogContract(media: MediaContract): CatalogContract {
  return {
    async listProducts() {
      return db.select().from(product).orderBy(desc(product.createdAt));
    },

    async createProduct(input: CreateProductInput) {
      const image = await media.processProductImage(input.image);

      try {
        const [createdProduct] = await db
          .insert(product)
          .values({
            title: input.title,
            description: input.description,
            price: input.price,
            stock: input.stock,
            imagePath: image.imagePath,
          })
          .returning();

        return createdProduct;
      } catch (error) {
        await media.deleteProductImage(image).catch(() => undefined);
        throw error;
      }
    },
  };
}
