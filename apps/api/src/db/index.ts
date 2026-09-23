import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
}

const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
