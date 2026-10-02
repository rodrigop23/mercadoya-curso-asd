import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createProductSyncWorker } from '../dist/modules/catalog/polar-worker.js';
import {
  ProductSyncRejected,
  ProductSyncRetryable,
  ProductSyncUncertain,
} from '../dist/modules/catalog/polar-gateway.js';
import { retryStoppedProducts } from '../dist/modules/catalog/polar-retry.js';

assert.ok(process.env.PRODUCTS_TEST_DATABASE_URL, 'Configura PRODUCTS_TEST_DATABASE_URL dedicado.');
const base = new Pool({ connectionString: process.env.PRODUCTS_TEST_DATABASE_URL });
const schema = `products_test_${randomBytes(8).toString('hex')}`;
await base.query(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.PRODUCTS_TEST_DATABASE_URL);
url.searchParams.set('options', `-csearch_path=${schema}`);
process.env.DATABASE_URL = url.href;
process.env.POLAR_SERVER = 'sandbox';
const { pool, closeDb } = await import('../dist/db/index.js');
const { createCatalogContract } = await import('../dist/modules/catalog/service.js');
const baseline = await readFile(
  new URL('../drizzle/0000_lumpy_lockheed.sql', import.meta.url),
  'utf8',
);
await pool.query(baseline.match(/CREATE TABLE "product" \([\s\S]*?\n\);/)[0]);
await pool.query(
  await readFile(new URL('../drizzle/0001_polar_products.sql', import.meta.url), 'utf8'),
);
await pool.query(
  await readFile(new URL('../drizzle/0002_polar_retry_limits.sql', import.meta.url), 'utf8'),
);
let cleaned = 0;
const catalog = createCatalogContract({
  async processProductImage() {
    return { imagePath: 'media/test.png', thumbPath: 'media/test-thumb.png' };
  },
  async deleteProductImage() {
    cleaned++;
  },
});
const input = (price = 12.34) => ({
  title: 'Producto',
  description: 'Descripción',
  price,
  stock: 10,
  image: new File(['fixture'], 'test.png'),
});
function fixture() {
  const remote = new Map();
  let creates = 0;
  let onCreate;
  let onFind;
  return {
    remote,
    get creates() {
      return creates;
    },
    set onCreate(fn) {
      onCreate = fn;
    },
    set onFind(fn) {
      onFind = fn;
    },
    gateway: {
      async prepare() {},
      async find(id) {
        if (onFind) await onFind();
        return remote.get(id)?.id ?? null;
      },
      async create(id, desired) {
        creates++;
        const product = { id: randomUUID(), ...desired };
        remote.set(id, product);
        if (onCreate) await onCreate();
        return product.id;
      },
      async update(id, desired) {
        const product = [...remote.values()].find((p) => p.id === id);
        Object.assign(product, desired);
      },
    },
  };
}
const due = () =>
  pool.query(
    "UPDATE catalog_polar_product SET next_attempt_at=now() WHERE state <> 'synced' AND next_attempt_at IS NOT NULL",
  );

test('Catalog sincroniza su proyección persistente sin duplicados entre réplicas', async (t) => {
  t.beforeEach(async () => {
    await pool.query('DELETE FROM catalog_polar_product');
    await pool.query('DELETE FROM product');
  });
  try {
    await t.test('backfill y CRUD sincronizan precio PEN; stock no cambia la versión', async () => {
      const fx = fixture();
      const worker = createProductSyncWorker(pool, 'sandbox', fx.gateway);
      const id = randomUUID();
      await pool.query(
        "INSERT INTO product(id,title,description,price,stock,image_path) VALUES ($1,'Existente','Prueba',12.34,10,'media/test.png')",
        [id],
      );
      await worker.reconcile();
      assert.equal((await catalog.getBillingProduct(id)).status, 'pending');
      await worker.tick();
      const first = await catalog.getBillingProduct(id);
      assert.equal(first.product.unitAmount, 1234);
      assert.equal(first.product.currency, 'pen');
      await catalog.adjustStock(id, -2);
      await worker.tick();
      assert.equal(fx.creates, 1);
      assert.equal((await catalog.getBillingProduct(id)).status, 'ready');
      await catalog.updateProduct(id, { ...input(8.75), image: undefined });
      assert.equal((await catalog.getBillingProduct(id)).status, 'pending');
      await worker.tick();
      assert.equal(
        (await catalog.getBillingProduct(id)).product.polarProductId,
        first.product.polarProductId,
      );
      assert.equal(fx.remote.get(id).unitAmount, 875);
    });
    await t.test(
      'dos réplicas y una edición durante POST conservan el ID y aplican la última versión',
      async () => {
        const fx = fixture();
        let release, started;
        const waiting = new Promise((resolve) => {
          release = resolve;
        });
        const called = new Promise((resolve) => {
          started = resolve;
        });
        fx.onCreate = async () => {
          started();
          await waiting;
        };
        const product = await catalog.createProduct(input());
        const first = createProductSyncWorker(pool, 'sandbox', fx.gateway);
        const second = createProductSyncWorker(pool, 'sandbox', fx.gateway);
        const running = first.tick();
        await called;
        await second.tick();
        await catalog.updateProduct(product.id, { ...input(15.2), image: undefined });
        release();
        await running;
        assert.equal((await catalog.getBillingProduct(product.id)).status, 'pending');
        await second.tick();
        assert.equal(fx.creates, 1);
        assert.equal(fx.remote.get(product.id).unitAmount, 1520);
        assert.equal((await catalog.getBillingProduct(product.id)).status, 'ready');
      },
    );
    await t.test(
      'respuesta perdida y fallo de lookup sobreviven al reinicio sin otro POST',
      async () => {
        const fx = fixture();
        fx.onCreate = async () => {
          throw new ProductSyncUncertain('lost_response');
        };
        const product = await catalog.createProduct(input());
        await createProductSyncWorker(pool, 'sandbox', fx.gateway).tick();
        fx.onFind = async () => {
          throw new ProductSyncRejected('polar_product_rejected');
        };
        await due();
        await createProductSyncWorker(pool, 'sandbox', fx.gateway).tick();
        assert.equal(
          (await pool.query('SELECT state FROM catalog_polar_product')).rows[0].state,
          'creating',
        );
        fx.onFind = undefined;
        await catalog.updateProduct(product.id, { ...input(24), image: undefined });
        await createProductSyncWorker(pool, 'sandbox', fx.gateway).tick();
        assert.equal(fx.creates, 1);
        assert.equal((await catalog.getBillingProduct(product.id)).product.unitAmount, 2400);
        assert.equal(fx.remote.get(product.id).unitAmount, 2400);
      },
    );
    await t.test('sin resultado remoto confirmado no repite una creación incierta', async () => {
      const fx = fixture();
      fx.onCreate = async () => {
        fx.remote.clear();
        throw new ProductSyncUncertain('never_arrived');
      };
      const product = await catalog.createProduct(input());
      const worker = createProductSyncWorker(pool, 'sandbox', fx.gateway);
      await worker.tick();
      await due();
      await worker.tick();
      assert.equal(fx.creates, 1);
      assert.equal((await catalog.getBillingProduct(product.id)).status, 'pending');
    });
    await t.test(
      'temporales paran en cinco intentos con backoff persistente tras reiniciar',
      async () => {
        const fx = fixture();
        let finds = 0;
        fx.onFind = async () => {
          finds++;
          throw new ProductSyncRetryable('polar_product_retry', 'products.find', 503);
        };
        const product = await catalog.createProduct(input());
        for (let attempt = 1; attempt <= 5; attempt++) {
          await createProductSyncWorker(pool, 'sandbox', fx.gateway).tick();
          const job = (
            await pool.query(
              'SELECT *, extract(epoch FROM next_attempt_at-now()) AS delay FROM catalog_polar_product',
            )
          ).rows[0];
          assert.equal(job.attempt_count, attempt);
          if (attempt < 5) {
            assert.ok(Number(job.delay) > 30 * 2 ** (attempt - 1) - 3);
            await due();
          } else assert.equal(job.next_attempt_at, null);
        }
        const restarted = createProductSyncWorker(pool, 'sandbox', fx.gateway);
        await restarted.reconcile();
        await restarted.tick();
        assert.equal(finds, 5);
        assert.equal(fx.creates, 0);
        assert.equal((await catalog.getBillingProduct(product.id)).status, 'failed');
        fx.onFind = undefined;
        assert.equal(await retryStoppedProducts(pool, 'sandbox', product.id), 1);
        await restarted.tick();
        assert.equal((await catalog.getBillingProduct(product.id)).status, 'ready');
        assert.equal(
          (await pool.query('SELECT attempt_count FROM catalog_polar_product')).rows[0]
            .attempt_count,
          0,
        );
      },
    );
    await t.test(
      'rechazo permanente se detiene al primer intento y la reactivación conserva el UUID',
      async () => {
        const fx = fixture();
        const product = await catalog.createProduct(input());
        const worker = createProductSyncWorker(pool, 'sandbox', fx.gateway);
        await worker.tick();
        const id = fx.remote.get(product.id).id;
        await catalog.updateProduct(product.id, { ...input(15), image: undefined });
        fx.gateway.update = async () => {
          throw new ProductSyncRejected('polar_validation_rejected', 'products.update', 422);
        };
        await worker.tick();
        await due();
        await worker.tick();
        const job = (await pool.query('SELECT * FROM catalog_polar_product')).rows[0];
        assert.equal(job.attempt_count, 1);
        assert.equal(job.next_attempt_at, null);
        assert.equal(job.polar_product_id, id);
        assert.equal((await catalog.getBillingProduct(product.id)).status, 'failed');
        assert.equal(await retryStoppedProducts(pool, 'production', product.id), 0);
        assert.equal(await retryStoppedProducts(pool, 'sandbox', product.id), 1);
        const requeued = (await pool.query('SELECT * FROM catalog_polar_product')).rows[0];
        assert.equal(requeued.polar_product_id, id);
        assert.equal(requeued.attempt_count, 0);
        assert.equal(fx.creates, 1);
      },
    );
    await t.test(
      'creación incierta agotada se puede reactivar sin volver a emitir POST',
      async () => {
        const fx = fixture();
        fx.onCreate = async () => {
          fx.remote.clear();
          throw new ProductSyncUncertain('polar_product_uncertain', 'products.create');
        };
        const product = await catalog.createProduct(input());
        const worker = createProductSyncWorker(pool, 'sandbox', fx.gateway);
        for (let attempt = 0; attempt < 5; attempt++) {
          await due();
          await worker.tick();
        }
        const job = (await pool.query('SELECT * FROM catalog_polar_product')).rows[0];
        assert.equal(job.state, 'creating');
        assert.equal(job.attempt_count, 5);
        assert.equal(job.next_attempt_at, null);
        assert.equal((await catalog.getBillingProduct(product.id)).status, 'failed');
        await worker.tick();
        assert.equal(await retryStoppedProducts(pool, 'sandbox', product.id), 1);
        await worker.tick();
        assert.equal(fx.creates, 1);
        assert.equal(
          (await pool.query('SELECT state FROM catalog_polar_product')).rows[0].state,
          'creating',
        );
      },
    );
    await t.test(
      'DELETE archiva y conserva tombstone; sandbox y producción tienen IDs distintos',
      async () => {
        const sandbox = fixture();
        const production = fixture();
        const product = await catalog.createProduct(input());
        const sw = createProductSyncWorker(pool, 'sandbox', sandbox.gateway);
        const pw = createProductSyncWorker(pool, 'production', production.gateway);
        await sw.tick();
        await pw.reconcile();
        await pw.tick();
        assert.notEqual(sandbox.remote.get(product.id).id, production.remote.get(product.id).id);
        await catalog.deleteProduct(product.id);
        await sw.tick();
        await pw.tick();
        assert.equal(sandbox.remote.get(product.id).archived, true);
        assert.equal(production.remote.get(product.id).archived, true);
        assert.equal(await catalog.getBillingProduct(product.id), null);
        assert.equal((await pool.query('SELECT * FROM catalog_polar_product')).rowCount, 2);
      },
    );
    await t.test('fallar la proyección revierte el producto y limpia la imagen', async () => {
      const before = cleaned;
      await pool.query('ALTER TABLE catalog_polar_product RENAME TO unavailable_projection');
      try {
        await assert.rejects(catalog.createProduct(input()));
        assert.equal((await pool.query('SELECT * FROM product')).rowCount, 0);
        assert.equal(cleaned, before + 1);
      } finally {
        await pool.query('ALTER TABLE unavailable_projection RENAME TO catalog_polar_product');
      }
    });
  } finally {
    await closeDb();
    await base.query(`DROP SCHEMA ${schema} CASCADE`);
    await base.end();
  }
});
