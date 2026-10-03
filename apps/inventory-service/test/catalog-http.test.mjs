import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createCatalogHttpClient } from '../dist/catalog/http.js';

test('respuesta perdida después del ajuste de carrito reintenta la misma operación sin descontar otra vez', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.CATALOG_INTERNAL_TOKEN;
  process.env.CATALOG_INTERNAL_TOKEN = randomUUID();
  const input = {
    operationId: randomUUID(),
    adjustments: [{ productId: randomUUID(), delta: -7 }],
  };
  let stock = 10;
  const operations = new Set();
  const requests = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (!operations.has(body.operationId)) {
        operations.add(body.operationId);
        stock += body.adjustments[0].delta;
        throw new Error('Respuesta perdida después del commit remoto.');
      }
      return Response.json({ adjusted: true });
    };
    assert.deepEqual(await createCatalogHttpClient().adjustStockBatch(input), { adjusted: true });
    assert.equal(stock, 3);
    assert.deepEqual(requests, [input, input]);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({}, { status: 401 });
    };
    await assert.rejects(createCatalogHttpClient().adjustStockBatch(input), /HTTP 401/);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('Catalog caído');
    };
    await assert.rejects(createCatalogHttpClient().adjustStockBatch(input), /Catalog caído/);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.CATALOG_INTERNAL_TOKEN;
    else process.env.CATALOG_INTERNAL_TOKEN = originalToken;
  }
});
