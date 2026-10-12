import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import type { MediaContract } from '../media/contract.js';
import { product } from './schema.js';
import type { CatalogContract, CreateProductInput, UpdateProductInput } from './contract.js';
import { queuePolarProduct } from './polar-queue.js';
import { polarServer } from './polar-config.js';
import type { CatalogBillingResponse } from '@mercadoya/contracts';

export function createCatalogContract(media: MediaContract): CatalogContract {
  return {
    async listProducts() {
      return db.select().from(product).orderBy(desc(product.createdAt));
    },

    async createProduct(input: CreateProductInput) {
      const image = await media.processProductImage(input.image);

      try {
        const createdProduct = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(product)
            .values({
              title: input.title,
              description: input.description,
              price: input.price,
              stock: input.stock,
              imagePath: image.imagePath,
            })
            .returning();
          if (!created) throw new Error('No se pudo guardar el producto.');
          await tx.execute(queuePolarProduct(created, polarServer()));
          return created;
        });

        return createdProduct;
      } catch (error) {
        await media.deleteProductImage(image).catch(() => undefined);
        throw error;
      }
    },

    async updateProduct(id: string, input: UpdateProductInput) {
      const [current] = await db.select().from(product).where(eq(product.id, id)).limit(1);
      if (!current) return null;

      const image = input.image ? await media.processProductImage(input.image) : null;
      try {
        const updated = await db.transaction(async (tx) => {
          const [changed] = await tx
            .update(product)
            .set({
              title: input.title,
              description: input.description,
              price: input.price,
              stock: input.stock,
              ...(image ? { imagePath: image.imagePath } : {}),
              updatedAt: new Date(),
            })
            .where(eq(product.id, id))
            .returning();
          if (changed) await tx.execute(queuePolarProduct(changed, polarServer()));
          return changed;
        });

        if (!updated) {
          if (image) await media.deleteProductImage(image).catch(() => undefined);
          return null;
        }
        if (image) {
          await media
            .deleteProductImage({
              imagePath: current.imagePath,
              thumbPath: current.imagePath.replace(/-full\.([^.]+)$/, '-thumb.$1'),
            })
            .catch(() => undefined);
        }
        return updated;
      } catch (error) {
        if (image) await media.deleteProductImage(image).catch(() => undefined);
        throw error;
      }
    },

    async deleteProduct(id: string) {
      const deleted = await db.transaction(async (tx) => {
        const [removed] = await tx.delete(product).where(eq(product.id, id)).returning();
        if (removed) await tx.execute(queuePolarProduct(removed, polarServer(), true));
        return removed;
      });
      if (!deleted) return false;
      await media
        .deleteProductImage({
          imagePath: deleted.imagePath,
          thumbPath: deleted.imagePath.replace(/-full\.([^.]+)$/, '-thumb.$1'),
        })
        .catch(() => undefined);
      return true;
    },

    async getBillingProduct(productId): Promise<CatalogBillingResponse | null> {
      const result =
        await db.execute(sql`SELECT p.id, p.title, p.image_path, round(p.price*100)::bigint AS unit_amount,
        s.polar_product_id, s.state, s.version, s.synced_version, s.error_code, s.next_attempt_at
        FROM product p LEFT JOIN catalog_polar_product s ON s.product_id=p.id AND s.server=${polarServer()}
        WHERE p.id=${productId}`);
      const row = result.rows[0];
      if (!row) return null;
      if (row.state === 'synced' && row.version === row.synced_version && row.polar_product_id) {
        return {
          status: 'ready',
          product: {
            productId,
            polarProductId: String(row.polar_product_id),
            unitAmount: Number(row.unit_amount),
            currency: 'pen',
            title: String(row.title),
            thumbnailPath: /-full\.[^.]+$/.test(String(row.image_path))
              ? String(row.image_path).replace(/-full\.([^.]+)$/, '-thumb.$1')
              : null,
          },
        };
      }
      return row.state === 'error' || (row.state && row.next_attempt_at === null)
        ? { status: 'failed', product: null }
        : { status: 'pending', product: null };
    },

    async getAvailableStock(productId) {
      const [result] = await db
        .select({ stock: product.stock })
        .from(product)
        .where(eq(product.id, productId))
        .limit(1);

      return result?.stock ?? null;
    },

    async adjustStockBatch({ operationId, adjustments }) {
      const ordered = [...adjustments].sort((a, b) => a.productId.localeCompare(b.productId));
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationId}, 1))`);
        const previous = await tx.execute(
          sql`SELECT adjustments = ${JSON.stringify(ordered)}::jsonb AS matches FROM catalog_stock_operation WHERE id=${operationId}`,
        );
        if (previous.rows[0]) {
          if (!previous.rows[0].matches) throw new Error('Operación de stock incompatible.');
          return { adjusted: true as const };
        }
        // Bloqueamos en el mismo orden para evitar deadlocks entre carritos concurrentes.
        for (const item of ordered) {
          const result = await tx.execute(
            sql`SELECT stock FROM product WHERE id=${item.productId} FOR UPDATE`,
          );
          const row = result.rows[0];
          if (!row) return { adjusted: false as const, reason: 'product_not_found' as const };
          const next = Number(row.stock) + item.delta;
          if (next < 0) return { adjusted: false as const, reason: 'insufficient_stock' as const };
          if (next > 2_147_483_647)
            return { adjusted: false as const, reason: 'stock_limit' as const };
        }
        for (const item of ordered)
          await tx
            .update(product)
            .set({ stock: sql`${product.stock} + ${item.delta}`, updatedAt: new Date() })
            .where(eq(product.id, item.productId));
        await tx.execute(
          sql`INSERT INTO catalog_stock_operation(id, adjustments) VALUES (${operationId}, ${JSON.stringify(ordered)}::jsonb)`,
        );
        return { adjusted: true as const };
      });
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
