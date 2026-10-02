import { sql } from 'drizzle-orm';

// La misma transacción guarda el producto y la proyección pendiente. Sin FK:
// el registro debe sobrevivir a DELETE para archivar el producto de Polar.
export function queuePolarProduct(
  product: { id: string; title: string; description: string; price: number },
  server: string,
  archived = false,
) {
  const desired = JSON.stringify({
    title: product.title,
    description: product.description,
    unitAmount: Math.round(product.price * 100),
    currency: 'pen',
    archived,
  });
  return sql`WITH servers AS (
      SELECT ${server}::text AS server UNION
      SELECT server FROM catalog_polar_product WHERE product_id=${product.id}::uuid
    ) INSERT INTO catalog_polar_product(product_id, server, desired)
    SELECT ${product.id}::uuid, server, ${desired}::jsonb FROM servers
    ON CONFLICT (product_id, server) DO UPDATE SET
      desired=EXCLUDED.desired, version=catalog_polar_product.version+1,
      state=CASE WHEN catalog_polar_product.state='creating'
        AND catalog_polar_product.polar_product_id IS NULL THEN 'creating' ELSE 'queued' END,
      error_code=NULL, attempt_count=0, next_attempt_at=now(), updated_at=now()
    WHERE catalog_polar_product.desired IS DISTINCT FROM EXCLUDED.desired`;
}
