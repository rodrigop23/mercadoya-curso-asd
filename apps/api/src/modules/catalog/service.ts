import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

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

    async getAvailableStock(productId) {
      const [result] = await db
        .select({ stock: product.stock })
        .from(product)
        .where(eq(product.id, productId))
        .limit(1);

      return result?.stock ?? null;
    },

    async adjustStock(productId, delta) {
      if (!Number.isSafeInteger(delta) || delta === 0) {
        throw new RangeError('El ajuste de stock debe ser un entero distinto de cero.');
      }

      const conditions = [eq(product.id, productId)];
      if (delta < 0) {
        conditions.push(gte(product.stock, -delta));
      } else {
        conditions.push(lte(product.stock, 2_147_483_647 - delta));
      }

      const [updatedProduct] = await db
        .update(product)
        .set({ stock: sql`${product.stock} + ${delta}`, updatedAt: new Date() })
        .where(and(...conditions))
        .returning({ stock: product.stock });

      if (updatedProduct) {
        return { adjusted: true, availableStock: updatedProduct.stock };
      }

      const availableStock = await this.getAvailableStock(productId);
      if (availableStock === null) {
        return { adjusted: false, reason: 'product_not_found' };
      }

      return {
        adjusted: false,
        reason: delta < 0 ? 'insufficient_stock' : 'stock_limit',
      };
    },
  };
}
