import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(406030)');
    await client.query(
      await readFile(new URL('../migrations/0001_identity.sql', import.meta.url), 'utf8'),
    );
    await client.query('COMMIT');
    console.log('Identity adopta las tablas existentes y añade jwks sin borrar datos.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
