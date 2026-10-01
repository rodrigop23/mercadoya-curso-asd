import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { z } from 'zod';
import { polarServer } from '../dist/modules/catalog/polar-config.js';
import { retryStoppedProducts } from '../dist/modules/catalog/polar-retry.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria.');
if (process.argv.length > 3) throw new Error('Uso: polar:retry [product-id]');
const productId = process.argv[2] ? z.uuid().parse(process.argv[2]) : undefined;
const server = polarServer();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const count = await retryStoppedProducts(pool, server, productId);
  console.log(JSON.stringify({ type: 'catalog.polar_sync_requeued', server, count }));
} finally {
  await pool.end();
}
