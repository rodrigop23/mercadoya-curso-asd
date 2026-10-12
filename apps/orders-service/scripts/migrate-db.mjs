import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(406030)');
  const ttl = Number(process.env.ORDER_PENDING_TTL_MINUTES ?? 15);
  if (!Number.isSafeInteger(ttl) || ttl <= 0)
    throw new Error('ORDER_PENDING_TTL_MINUTES debe ser un entero positivo.');
  await client.query("SELECT set_config('mercadoya.order_pending_ttl_minutes', $1, true)", [
    String(ttl),
  ]);
  await client.query(await readFile(new URL('../db/0001_payments.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../db/0002_pricing.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../db/0003_cart.sql', import.meta.url), 'utf8'));
  await client.query(
    await readFile(new URL('../db/0004_purchase_product.sql', import.meta.url), 'utf8'),
  );
  await client.query(
    await readFile(new URL('../db/0005_order_lifecycle.sql', import.meta.url), 'utf8'),
  );
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
