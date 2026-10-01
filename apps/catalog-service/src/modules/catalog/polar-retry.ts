import type { Pool } from 'pg';

export async function retryStoppedProducts(pool: Pool, server: string, productId?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Comparte el lock del worker para no reactivar mientras otro intento sigue en vuelo.
    await client.query('SELECT pg_advisory_xact_lock(406032)');
    const result = await client.query(
      `UPDATE catalog_polar_product SET attempt_count=0, error_code=NULL,
      state=CASE WHEN state='creating' AND polar_product_id IS NULL THEN 'creating' ELSE 'queued' END,
      next_attempt_at=now(), updated_at=now()
      WHERE server=$1 AND state <> 'synced' AND next_attempt_at IS NULL
        AND ($2::uuid IS NULL OR product_id=$2::uuid)`,
      [server, productId ?? null],
    );
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
