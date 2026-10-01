import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAthenaDemo } from '../scripts/run-athena-demo.mjs';

// Respuestas simuladas: prueban los controles del comando, no una ejecución de Athena.
function fixture(change = () => {}) {
  const outputs = {
    AccountId: '111122223333',
    Region: 'us-east-1',
    CuratedDatabaseName: 'mercadoya_analytics_demo_curated',
    CuratedLocation: 's3://curated-bucket/curated/',
    ArtifactsBucketName: 'artifacts-bucket',
    AthenaWorkGroupName: 'mercadoya-cloud-analytics-demo',
    AthenaResultsLocation: 's3://artifacts-bucket/athena-results/',
  };
  const schemas = {
    customers: { customer_id: 'string', segment: 'string', city: 'string' },
    products: {
      product_id: 'string',
      title: 'string',
      category: 'string',
      price: 'decimal(18,2)',
      currency: 'string',
    },
    orders: {
      order_id: 'string',
      customer_id: 'string',
      order_date: 'timestamp',
      status: 'string',
      total_amount: 'decimal(18,2)',
      channel: 'string',
      currency: 'string',
    },
    order_items: {
      order_id: 'string',
      product_id: 'string',
      quantity: 'int',
      unit_price: 'decimal(18,2)',
      line_total: 'decimal(18,2)',
    },
    inventory_snapshots: { product_id: 'string', snapshot_date: 'date' },
    payments: { order_id: 'string', amount: 'decimal(18,2)' },
  };
  const calls = [];
  let queryNumber = 0;
  function aws(args) {
    calls.push(args);
    const value = (flag) => args[args.indexOf(flag) + 1];
    let result;
    switch (args[1]) {
      case 'get-caller-identity':
        result = { Account: outputs.AccountId };
        break;
      case 'get-work-group':
        result = {
          WorkGroup: {
            Name: outputs.AthenaWorkGroupName,
            State: 'ENABLED',
            Configuration: {
              EnforceWorkGroupConfiguration: true,
              EngineVersion: { SelectedEngineVersion: 'Athena engine version 3' },
              ResultConfiguration: {
                OutputLocation: outputs.AthenaResultsLocation,
                ExpectedBucketOwner: outputs.AccountId,
                EncryptionConfiguration: { EncryptionOption: 'SSE_S3' },
              },
            },
          },
        };
        break;
      case 'get-table': {
        const name = value('--name');
        result = {
          Table: {
            Name: name,
            DatabaseName: outputs.CuratedDatabaseName,
            Parameters: { classification: 'parquet' },
            StorageDescriptor: {
              Location: `${outputs.CuratedLocation}${name}/`,
              InputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
              Columns: Object.entries(schemas[name]).map(([Name, Type]) => ({ Name, Type })),
            },
          },
        };
        break;
      }
      case 'start-query-execution':
        result = { QueryExecutionId: `query-${++queryNumber}` };
        break;
      case 'get-query-execution':
        result = {
          QueryExecution: {
            WorkGroup: outputs.AthenaWorkGroupName,
            QueryExecutionContext: {
              Database: outputs.CuratedDatabaseName,
              Catalog: 'awsdatacatalog',
            },
            Status: { State: 'SUCCEEDED' },
            ResultConfiguration: {
              OutputLocation: `${outputs.AthenaResultsLocation}${value('--query-execution-id')}.csv`,
              EncryptionConfiguration: { EncryptionOption: 'SSE_S3' },
            },
          },
        };
        break;
      case 'head-object':
        result = { ContentLength: 123 };
        break;
      case 'get-query-results': {
        const proof = value('--query-execution-id') === 'query-1';
        const names = proof
          ? ['table_name', 'parquet_file', 'row_count', 'invalid_status_rows']
          : ['sales_amount', 'city'];
        const rows = proof
          ? Object.keys(schemas).map((name) => [
              name,
              `${outputs.CuratedLocation}${name}/part-000.parquet`,
              '1',
              '0',
            ])
          : [['0.30', null]];
        result = {
          ResultSet: {
            ResultSetMetadata: { ColumnInfo: names.map((Name) => ({ Name })) },
            Rows: [names, ...rows].map((row) => ({
              Data: row.map((cell) => (cell === null ? {} : { VarCharValue: cell })),
            })),
          },
        };
        break;
      }
      default:
        throw new Error(`Operación no esperada: ${args.join(' ')}`);
    }
    change(args, result);
    return result;
  }
  return { outputs, aws, calls, log: () => {} };
}

test('reuses the scaffold, verifies six curated tables and preserves decimals and NULL', async () => {
  const input = fixture();
  const evidence = await runAthenaDemo(input);
  assert.equal(evidence.curatedTables.length, 6);
  assert.equal(evidence.queries.length, 4);
  assert.equal(evidence.queries[1].rows[0].sales_amount, '0.30');
  assert.equal(evidence.queries[1].rows[0].city, null);
  for (const args of input.calls.filter((call) => call[1] === 'start-query-execution')) {
    assert.ok(!args.includes('--result-configuration'));
    assert.ok(!args.join(' ').includes('mercadoya_analytics_demo_raw'));
    assert.ok(args.includes(input.outputs.AthenaWorkGroupName));
    const context = JSON.parse(args[args.indexOf('--query-execution-context') + 1]);
    assert.equal(context.Database, input.outputs.CuratedDatabaseName);
  }
});

test('rejects a catalog pointing to raw before starting queries', async () => {
  const input = fixture((args, result) => {
    if (args[1] === 'get-table') result.Table.StorageDescriptor.Location = 's3://raw/raw/orders/';
  });
  await assert.rejects(runAthenaDemo(input), /ubicación del catálogo debe ser curated/);
  assert.ok(!input.calls.some((args) => args[1] === 'start-query-execution'));
});

test('rejects nondecimal money before starting queries', async () => {
  const input = fixture((args, result) => {
    if (args[1] === 'get-table') {
      const price = result.Table.StorageDescriptor.Columns.find(
        (column) => column.Name === 'price',
      );
      if (price) price.Type = 'double';
    }
  });
  await assert.rejects(runAthenaDemo(input), /products.price/);
  assert.ok(!input.calls.some((args) => args[1] === 'start-query-execution'));
});

test('rejects an unexpected workgroup results location before starting queries', async () => {
  const input = fixture((args, result) => {
    if (args[1] === 'get-work-group')
      result.WorkGroup.Configuration.ResultConfiguration.OutputLocation = 's3://other/';
  });
  await assert.rejects(runAthenaDemo(input));
  assert.ok(!input.calls.some((args) => args[1] === 'start-query-execution'));
});

test('reports a failed execution and does not continue to business queries', async () => {
  const input = fixture((args, result) => {
    if (args[1] === 'get-query-execution')
      result.QueryExecution.Status = { State: 'FAILED', StateChangeReason: 'AccessDenied' };
  });
  await assert.rejects(runAthenaDemo(input), /AccessDenied/);
  assert.equal(input.calls.filter((args) => args[1] === 'start-query-execution').length, 1);
});

test('rejects a successful execution with results outside the scaffold prefix', async () => {
  const input = fixture((args, result) => {
    if (args[1] === 'get-query-execution')
      result.QueryExecution.ResultConfiguration.OutputLocation = 's3://other/query-1.csv';
  });
  await assert.rejects(runAthenaDemo(input), /resultado debe caer en AthenaResultsLocation/);
});

test('rejects empty results and unnormalized order statuses', async () => {
  for (const invalid of ['empty', 'status']) {
    const input = fixture((args, result) => {
      if (args[1] !== 'get-query-results') return;
      if (invalid === 'empty') result.ResultSet.Rows = result.ResultSet.Rows.slice(0, 1);
      else result.ResultSet.Rows[1].Data[3].VarCharValue = '1';
    });
    await assert.rejects(
      runAthenaDemo(input),
      invalid === 'empty' ? /devolver filas/ : /estados sin normalizar/,
    );
  }
});
