import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
}

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 1_000,
  query_timeout: 1_500,
});
export const db = drizzle(pool);
export async function closeDb() {
  await pool.end();
}
