import { config } from 'dotenv';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
}

export const pool = new Pool({ connectionString });
