import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.DATABASE_URL = 'postgresql://unused:unused@localhost/unused';
const { pool, closeDb } = await import('../dist/db/index.js');
const { createCatalogContract } = await import('../dist/modules/catalog/service.js');
after(closeDb);
const catalog = createCatalogContract({});

test('listado combina filtros inclusivos y escapa comodines con parámetros SQL', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (query, params) => {
    queries.push({ text: query.text, params });
    return { rows: [] };
  });

  await catalog.listProducts();
  assert.doesNotMatch(queries[0].text, /where/i);
  assert.match(queries[0].text, /order by "product"\."created_at" desc$/);
  assert.deepEqual(queries[0].params, []);

  await catalog.listProducts({ q: 'AUD%_\\', minPrice: 20, maxPrice: 100.5 });
  assert.match(queries[1].text, /"title" ilike \$1 or "product"\."description" ilike \$2/);
  assert.match(queries[1].text, /"price" >= \$3/);
  assert.match(queries[1].text, /"price" <= \$4/);
  assert.match(queries[1].text, /order by "product"\."created_at" desc$/);
  assert.deepEqual(queries[1].params, ['%AUD\\%\\_\\\\%', '%AUD\\%\\_\\\\%', '20', '100.5']);

  await catalog.listProducts({ minPrice: 0 });
  assert.match(queries[2].text, /"price" >= \$1/);
  assert.doesNotMatch(queries[2].text, /ilike|<=/);
  assert.deepEqual(queries[2].params, ['0']);
});

test('detalle usa id parametrizado, límite uno y devuelve null para ausencia', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (query, params) => {
    queries.push({ text: query.text, params });
    return { rows: [] };
  });
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(await catalog.getProduct(id), null);
  assert.match(queries[0].text, /where "product"\."id" = \$1 limit \$2/);
  assert.deepEqual(queries[0].params, [id, 1]);
});
