import type { Pool } from 'pg';
import {
  ProductSyncRejected,
  ProductSyncError,
  ProductSyncRetryable,
  ProductSyncUncertain,
  type ProductGateway,
  type DesiredProduct,
} from './polar-gateway.js';

type Job = {
  product_id: string;
  desired: DesiredProduct;
  version: number;
  state: string;
  polar_product_id: string | null;
  attempt_count: number;
};

export const PRODUCT_SYNC_MAX_ATTEMPTS = 5;

export function createProductSyncWorker(pool: Pool, server: string, gateway: ProductGateway) {
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function reconcile() {
    // Recupera productos existentes, también al cambiar de sandbox a producción.
    await pool.query(
      `INSERT INTO catalog_polar_product(product_id, server, desired)
      SELECT id, $1, jsonb_build_object('title', title, 'description', description,
        'unitAmount', round(price*100)::bigint, 'currency', 'pen', 'archived', false)
        FROM (SELECT * FROM product FOR UPDATE) AS current_products
      ON CONFLICT (product_id, server) DO UPDATE SET
        desired=EXCLUDED.desired, version=catalog_polar_product.version+1,
        state=CASE WHEN catalog_polar_product.state='creating' AND catalog_polar_product.polar_product_id IS NULL
          THEN 'creating' ELSE 'queued' END,
        error_code=NULL, attempt_count=0, next_attempt_at=now(), updated_at=now()
      WHERE catalog_polar_product.desired IS DISTINCT FROM EXCLUDED.desired`,
      [server],
    );
    await pool.query(
      `UPDATE catalog_polar_product SET
      desired=jsonb_set(desired, '{archived}', 'true'), version=version+1,
      state=CASE WHEN state='creating' AND polar_product_id IS NULL THEN 'creating' ELSE 'queued' END,
      error_code=NULL, attempt_count=0, next_attempt_at=now(), updated_at=now()
      WHERE server=$1 AND desired->>'archived'='false'
        AND NOT EXISTS (SELECT 1 FROM product WHERE id=product_id)`,
      [server],
    );
  }
  async function run() {
    const client = await pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(406032) AS locked',
      );
      locked = result.rows[0]!.locked;
      if (!locked) return;
      const {
        rows: [job],
      } = await client.query<Job>(
        `SELECT * FROM catalog_polar_product
        WHERE server=$1 AND state <> 'synced' AND next_attempt_at <= now()
          AND attempt_count < $2
        ORDER BY next_attempt_at, product_id LIMIT 1`,
        [server, PRODUCT_SYNC_MAX_ATTEMPTS],
      );
      if (!job) return;
      // Persiste el intento antes de llamar a Polar, también frente a reinicios.
      const claimed = await client.query<{ attempt_count: number }>(
        `UPDATE catalog_polar_product SET attempt_count=attempt_count+1,
        next_attempt_at=CASE WHEN attempt_count+1 >= $4 THEN NULL
          ELSE now()+interval '30 seconds' END, updated_at=now()
        WHERE product_id=$1 AND server=$2 AND version=$3 RETURNING attempt_count`,
        [job.product_id, server, job.version, PRODUCT_SYNC_MAX_ATTEMPTS],
      );
      if (!claimed.rowCount) return;
      const attempt = claimed.rows[0]!.attempt_count;
      let remoteId = job.polar_product_id;
      let creating = job.state === 'creating' && !remoteId;
      try {
        if (!job.desired.archived || remoteId || creating) {
          await gateway.prepare();
          if (!remoteId) {
            // Metadata permite recuperar un POST completado cuya respuesta se perdió.
            remoteId = await gateway.find(job.product_id);
            if (!remoteId && creating) throw new ProductSyncUncertain('polar_product_uncertain');
            if (!remoteId && !job.desired.archived) {
              await client.query(
                `UPDATE catalog_polar_product SET state='creating'
                WHERE product_id=$1 AND server=$2`,
                [job.product_id, server],
              );
              creating = true;
              remoteId = await gateway.create(job.product_id, job.desired);
            } else if (remoteId) {
              await gateway.update(remoteId, job.desired);
            }
          } else {
            await gateway.update(remoteId, job.desired);
          }
        }
        await client.query(
          `UPDATE catalog_polar_product SET polar_product_id=$3,
          synced_version=$4, state=CASE WHEN version=$4 THEN 'synced' ELSE 'queued' END,
          error_code=NULL, attempt_count=0, next_attempt_at=now(), updated_at=now() WHERE product_id=$1 AND server=$2`,
          [job.product_id, server, remoteId, job.version],
        );
      } catch (error) {
        const uncertain =
          (job.state === 'creating' && !job.polar_product_id) ||
          error instanceof ProductSyncUncertain ||
          (creating &&
            !(error instanceof ProductSyncRejected || error instanceof ProductSyncRetryable));
        const code =
          error instanceof ProductSyncError
            ? error.message
            : uncertain
              ? 'polar_product_uncertain'
              : 'polar_product_retry';
        const stopped =
          error instanceof ProductSyncRejected || attempt >= PRODUCT_SYNC_MAX_ATTEMPTS;
        const retryAfter =
          error instanceof ProductSyncRetryable && Number.isFinite(error.retryAfter)
            ? Math.max(0, Math.min(3600, error.retryAfter!))
            : 0;
        const delaySeconds = Math.max(30 * 2 ** (attempt - 1), retryAfter);
        const outcome = await client.query<{ next_attempt_at: Date | null }>(
          `UPDATE catalog_polar_product SET
          state=CASE WHEN $3 THEN 'creating' WHEN version=$4 THEN 'error' ELSE 'queued' END,
          error_code=CASE WHEN version=$4 THEN $5 ELSE NULL END,
          next_attempt_at=CASE WHEN version<>$4 THEN now() WHEN $6 THEN NULL
            ELSE now()+$7*interval '1 second' END, updated_at=now()
          WHERE product_id=$1 AND server=$2 RETURNING next_attempt_at`,
          [job.product_id, server, uncertain, job.version, code, stopped, delaySeconds],
        );
        const willRetry = outcome.rows[0]?.next_attempt_at != null;
        console.warn(
          JSON.stringify({
            type: willRetry ? 'catalog.polar_sync_retry' : 'catalog.polar_sync_stopped',
            productId: job.product_id,
            server,
            code,
            operation: error instanceof ProductSyncError ? error.operation : undefined,
            httpStatus: error instanceof ProductSyncError ? error.httpStatus : undefined,
            attempt,
            maxAttempts: PRODUCT_SYNC_MAX_ATTEMPTS,
            nextAttemptAt: outcome.rows[0]?.next_attempt_at ?? null,
          }),
        );
      }
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(406032)');
        client.release();
      } catch {
        client.release(true);
      }
    }
  }
  function tick() {
    if (!active)
      active = run().finally(() => {
        active = undefined;
      });
    return active;
  }
  return {
    reconcile,
    tick,
    async start() {
      await reconcile();
      timer = setInterval(() => {
        void tick().catch(() => console.warn('catalog.polar_worker_retry'));
      }, 250);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      await active;
    },
  };
}
