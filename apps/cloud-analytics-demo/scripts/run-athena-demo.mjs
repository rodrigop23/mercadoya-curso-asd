import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const database = 'mercadoya_analytics_demo_curated';
const workGroupName = 'mercadoya-cloud-analytics-demo';
const columns = {
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
const queries = [
  '00_verify_curated.sql',
  '01_orders_by_month_status.sql',
  '02_revenue_by_segment.sql',
  '03_top_products.sql',
];

function awsCli(region) {
  return (args) => {
    const result = spawnSync(
      'aws',
      [
        ...args,
        '--region',
        region,
        '--no-cli-pager',
        '--output',
        'json',
        '--cli-connect-timeout',
        '10',
        '--cli-read-timeout',
        '30',
      ],
      { encoding: 'utf8', env: { ...process.env, AWS_PAGER: '' }, timeout: 60_000 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim() ? JSON.parse(result.stdout) : {};
  };
}

export async function runAthenaDemo({ outputs, aws, log = console.log, poll = setTimeout }) {
  for (const key of [
    'AccountId',
    'Region',
    'CuratedDatabaseName',
    'CuratedLocation',
    'AthenaWorkGroupName',
    'AthenaResultsLocation',
    'ArtifactsBucketName',
  ])
    assert.ok(outputs[key], `Falta output ${key}. Usa el scaffold desplegado.`);
  assert.equal(outputs.CuratedDatabaseName, database);
  assert.equal(outputs.AthenaWorkGroupName, workGroupName);
  assert.equal(
    outputs.AthenaResultsLocation,
    `s3://${outputs.ArtifactsBucketName}/athena-results/`,
  );
  assert.match(outputs.CuratedLocation, /^s3:\/\/[^/]+\/curated\/$/);
  assert.equal(
    aws(['sts', 'get-caller-identity']).Account,
    outputs.AccountId,
    'La sesión AWS debe coincidir con AccountId del stack',
  );

  const workGroup = aws(['athena', 'get-work-group', '--work-group', workGroupName]).WorkGroup;
  assert.equal(workGroup.Name, workGroupName);
  assert.equal(workGroup.State, 'ENABLED');
  const config = workGroup.Configuration;
  assert.equal(config.EnforceWorkGroupConfiguration, true);
  assert.equal(config.EngineVersion.SelectedEngineVersion, 'Athena engine version 3');
  assert.notEqual(config.ManagedQueryResultsConfiguration?.Enabled, true);
  assert.equal(config.ResultConfiguration.OutputLocation, outputs.AthenaResultsLocation);
  assert.equal(config.ResultConfiguration.EncryptionConfiguration.EncryptionOption, 'SSE_S3');
  assert.equal(config.ResultConfiguration.ExpectedBucketOwner, outputs.AccountId);

  const evidence = {
    account: outputs.AccountId,
    region: outputs.Region,
    verifiedAt: new Date().toISOString(),
    database,
    workGroup: workGroupName,
    resultsLocation: outputs.AthenaResultsLocation,
    workGroupConfiguration: config,
    curatedTables: [],
    queries: [],
  };
  for (const [name, requiredColumns] of Object.entries(columns)) {
    const table = aws(['glue', 'get-table', '--database-name', database, '--name', name]).Table;
    assert.equal(table.Name, name);
    assert.equal(table.DatabaseName, database);
    const storage = table.StorageDescriptor;
    assert.equal(
      storage.Location.replace(/\/$/, ''),
      `${outputs.CuratedLocation}${name}`,
      `${name}: la ubicación del catálogo debe ser curated`,
    );
    assert.equal(table.Parameters?.classification, 'parquet');
    assert.equal(
      storage.InputFormat,
      'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
    );
    const types = Object.fromEntries(storage.Columns.map(({ Name, Type }) => [Name, Type]));
    for (const [column, type] of Object.entries(requiredColumns)) {
      assert.equal(types[column], type, `${database}.${name}.${column}`);
    }
    evidence.curatedTables.push({
      name,
      database,
      location: storage.Location,
      classification: 'parquet',
      inputFormat: storage.InputFormat,
      columns: storage.Columns,
    });
  }
  log(`Catálogo curated verificado: seis tablas Parquet en ${outputs.CuratedLocation}`);

  for (const file of queries) {
    const sql = await readFile(`${appDirectory}athena/${file}`, 'utf8');
    const id = aws([
      'athena',
      'start-query-execution',
      '--work-group',
      workGroupName,
      '--query-execution-context',
      JSON.stringify({ Catalog: 'AwsDataCatalog', Database: database }),
      '--result-reuse-configuration',
      JSON.stringify({ ResultReuseByAgeConfiguration: { Enabled: false } }),
      '--query-string',
      sql,
    ]).QueryExecutionId;
    assert.ok(id, `${file}: falta QueryExecutionId`);
    const deadline = Date.now() + 5 * 60_000;
    let query;
    let previous;
    while (Date.now() < deadline) {
      query = aws(['athena', 'get-query-execution', '--query-execution-id', id]).QueryExecution;
      const state = query.Status.State;
      if (state !== previous) log(`${file}/${id}: ${state}`);
      previous = state;
      if (state === 'SUCCEEDED') break;
      if (['FAILED', 'CANCELLED'].includes(state)) {
        throw new Error(`${file}/${id}: ${query.Status.StateChangeReason ?? state}`);
      }
      await poll(2_000);
    }
    assert.equal(
      query?.Status.State,
      'SUCCEEDED',
      `${file}/${id}: se excedió la espera; revisa esta ejecución en AWS antes de repetir`,
    );
    assert.equal(query.WorkGroup, workGroupName);
    assert.equal(query.QueryExecutionContext.Database, database);
    assert.equal(query.QueryExecutionContext.Catalog?.toLowerCase(), 'awsdatacatalog');
    const resultLocation = query.ResultConfiguration.OutputLocation;
    assert.equal(
      resultLocation,
      `${outputs.AthenaResultsLocation}${id}.csv`,
      `${file}: el resultado debe caer en AthenaResultsLocation`,
    );
    assert.equal(query.ResultConfiguration.EncryptionConfiguration.EncryptionOption, 'SSE_S3');
    const url = new URL(resultLocation);
    const object = aws([
      's3api',
      'head-object',
      '--bucket',
      url.hostname,
      '--key',
      url.pathname.slice(1),
    ]);
    assert.ok(object.ContentLength > 0, `${file}: falta CSV de resultados en S3`);

    // AWS CLI pagina automáticamente; NULL no contiene VarCharValue.
    const result = aws(['athena', 'get-query-results', '--query-execution-id', id]).ResultSet;
    const names = result.ResultSetMetadata.ColumnInfo.map(({ Name }) => Name);
    const rows = result.Rows.slice(1).map(({ Data }) =>
      Object.fromEntries(names.map((name, index) => [name, Data[index]?.VarCharValue ?? null])),
    );
    assert.ok(rows.length > 0, `${file}: la consulta debe devolver filas`);
    if (file === queries[0]) {
      assert.deepEqual(
        [...new Set(rows.map((row) => row.table_name))].sort(),
        Object.keys(columns).sort(),
      );
      for (const row of rows) {
        assert.ok(Number(row.row_count) > 0);
        assert.equal(Number(row.invalid_status_rows), 0, 'orders contiene estados sin normalizar');
        assert.ok(row.parquet_file?.startsWith(`${outputs.CuratedLocation}${row.table_name}/`));
        assert.ok(row.parquet_file.endsWith('.parquet'));
      }
    }
    evidence.queries.push({
      file,
      sql,
      queryExecutionId: id,
      state: query.Status.State,
      resultLocation,
      statistics: query.Statistics,
      columns: names,
      rowCount: rows.length,
      rows,
    });
    log(`${file}: ${rows.length} filas. Resultado: ${resultLocation}`);
    log(JSON.stringify(rows.slice(0, 3), null, 2));
  }
  return evidence;
}

async function main() {
  let outputs;
  if (process.argv[2]) {
    outputs = JSON.parse(await readFile(process.argv[2], 'utf8')).CloudAnalyticsDemoStack;
  } else {
    const region =
      process.env.CDK_DEFAULT_REGION ??
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      'us-east-1';
    const stack = awsCli(region)([
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'CloudAnalyticsDemoStack',
    ]).Stacks[0];
    outputs = Object.fromEntries(
      stack.Outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]),
    );
  }
  assert.ok(outputs, 'Faltan outputs de CloudAnalyticsDemoStack');
  const evidence = await runAthenaDemo({ outputs, aws: awsCli(outputs.Region) });
  const path = `${appDirectory}cdk.out/athena-demo-evidence.json`;
  await mkdir(`${appDirectory}cdk.out`, { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Datamart verificado en Athena. Evidencia: ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
