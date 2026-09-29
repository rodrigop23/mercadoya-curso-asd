import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

if (process.argv.length !== 3 || process.argv[2] !== '--yes') {
  console.error('Uso: pnpm --filter @mercadoya/api db:reset --yes');
  console.error('Este comando elimina todos los datos y tablas de los esquemas public y drizzle.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL es obligatoria.');
}

const target = new URL(process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  console.log(
    `Reiniciando ${target.pathname.slice(1)} en ${target.hostname}:${target.port || '5432'}...`,
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log('Migraciones aplicadas. La base de datos quedó sin registros de la aplicación.');
} finally {
  await pool.end();
}
