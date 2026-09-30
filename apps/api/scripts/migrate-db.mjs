import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const folder = new URL('../drizzle/', import.meta.url);
try {
  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', folder), 'utf8'));
  const first = journal.entries[0];
  const sql = await readFile(new URL(`${first.tag}.sql`, folder), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(406029)');
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(
      'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );
    const existing = await client.query('SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1');
    if (!existing.rowCount) {
      // Adopt installations created by db:push, preserving the immutable historical baseline.
      for (let statement of sql
        .split('--> statement-breakpoint')
        .map((value) => value.trim())
        .filter(Boolean)) {
        statement = statement
          .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
          .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS ')
          .replace(/^CREATE UNIQUE INDEX /, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
        if (statement.startsWith('ALTER TABLE'))
          statement = `DO $$ BEGIN ${statement} EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
        await client.query(statement);
      }
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1,$2)',
        [createHash('sha256').update(sql).digest('hex'), first.when],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(folder) });
} finally {
  await pool.end();
}
