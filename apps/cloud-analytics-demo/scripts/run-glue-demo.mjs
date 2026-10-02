import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const outputsPath = process.argv[2] ?? `${appDirectory}cdk.out/outputs.json`;
const outputs = JSON.parse(await readFile(outputsPath, 'utf8')).CloudAnalyticsDemoStack;
assert.ok(outputs, `Faltan outputs de CloudAnalyticsDemoStack en ${outputsPath}`);
for (const key of [
  'AccountId',
  'Region',
  'RawLocation',
  'CuratedLocation',
  'RawDatabaseName',
  'CuratedDatabaseName',
  'RawCrawlerName',
  'CuratedCrawlerName',
  'GlueJobName',
  'GlueScriptAssetLocation',
  'GlueScriptLocation',
  'AthenaWorkGroupName',
]) {
  assert.ok(outputs[key], `Falta output ${key}. Despliega la version actual del stack.`);
}

function aws(args, json = true) {
  const result = spawnSync(
    'aws',
    [...args, '--region', outputs.Region, '--no-cli-pager', ...(json ? ['--output', 'json'] : [])],
    {
      encoding: 'utf8',
      env: { ...process.env, AWS_PAGER: '' },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return json && result.stdout.trim() ? JSON.parse(result.stdout) : result.stdout;
}

async function waitFor(label, readState, success, failure, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let previous;
  while (Date.now() < deadline) {
    const { state, details } = readState();
    if (state !== previous) console.log(`${label}: ${state}`);
    previous = state;
    if (failure.includes(state)) throw new Error(`${label}: ${JSON.stringify(details)}`);
    if (state === success) return details;
    await setTimeout(15_000);
  }
  throw new Error(`${label}: se excedio el tiempo de espera; revisa AWS antes de repetir.`);
}

async function crawl(name) {
  const current = aws(['glue', 'get-crawler', '--name', name]).Crawler;
  assert.equal(current.State, 'READY', `${name} ya esta ejecutandose`);
  const previousStart = current.LastCrawl?.StartTime;
  aws(['glue', 'start-crawler', '--name', name]);
  return waitFor(
    name,
    () => {
      const crawler = aws(['glue', 'get-crawler', '--name', name]).Crawler;
      const last = crawler.LastCrawl;
      const newCrawl = last?.StartTime && last.StartTime !== previousStart;
      return {
        state: crawler.State === 'READY' && newCrawl ? last.Status : 'RUNNING',
        details: last,
      };
    },
    'SUCCEEDED',
    ['FAILED', 'CANCELLED'],
    30 * 60_000,
  );
}

function catalog(database, expectedTables, classification) {
  const tables = aws(['glue', 'get-tables', '--database-name', database]).TableList;
  assert.deepEqual(tables.map((table) => table.Name).sort(), Object.keys(expectedTables).sort());
  return tables.map((table) => {
    assert.equal(table.Parameters.classification, classification, table.Name);
    const storage = table.StorageDescriptor;
    assert.deepEqual(
      storage.Columns.map((column) => column.Name),
      expectedTables[table.Name].columns,
      `${database}.${table.Name}: columnas`,
    );
    const prefix = classification === 'csv' ? outputs.RawLocation : outputs.CuratedLocation;
    assert.equal(storage.Location.replace(/\/$/, ''), `${prefix}${table.Name}`);
    return {
      name: table.Name,
      location: storage.Location,
      columns: storage.Columns,
      classification,
      inputFormat: storage.InputFormat,
    };
  });
}

assert.equal(
  aws(['sts', 'get-caller-identity']).Account,
  outputs.AccountId,
  'La sesion AWS debe coincidir con AccountId del stack',
);
console.log(`Demo en cuenta ${outputs.AccountId}, region ${outputs.Region}`);
// Copia el asset publicado por CDK, usando la identidad del docente, no jobRole.
aws(['s3', 'cp', outputs.GlueScriptAssetLocation, outputs.GlueScriptLocation], false);
const expectedTables = {};
for (const table of [
  'customers',
  'products',
  'orders',
  'order_items',
  'inventory_snapshots',
  'payments',
]) {
  const source = `${appDirectory}seed/raw/${table}.csv`;
  const lines = (await readFile(source, 'utf8')).trimEnd().split(/\r?\n/);
  // La semilla versionada no contiene campos con saltos de linea.
  expectedTables[table] = { columns: lines[0].split(','), rows: lines.length - 1 };
  aws(['s3', 'cp', source, `${outputs.RawLocation}${table}/${table}.csv`], false);
}

const evidence = {
  account: outputs.AccountId,
  region: outputs.Region,
  verifiedAt: new Date().toISOString(),
  script: outputs.GlueScriptLocation,
};
evidence.rawCrawl = await crawl(outputs.RawCrawlerName);
evidence.rawTables = catalog(outputs.RawDatabaseName, expectedTables, 'csv');
const runId = aws(['glue', 'start-job-run', '--job-name', outputs.GlueJobName]).JobRunId;
evidence.jobRun = await waitFor(
  `${outputs.GlueJobName}/${runId}`,
  () => {
    const run = aws([
      'glue',
      'get-job-run',
      '--job-name',
      outputs.GlueJobName,
      '--run-id',
      runId,
    ]).JobRun;
    return { state: run.JobRunState, details: run };
  },
  'SUCCEEDED',
  ['FAILED', 'TIMEOUT', 'STOPPED', 'ERROR', 'EXPIRED'],
  20 * 60_000,
);
evidence.parquet = {};
for (const table of Object.keys(expectedTables)) {
  const location = new URL(outputs.CuratedLocation);
  const objects =
    aws([
      's3api',
      'list-objects-v2',
      '--bucket',
      location.hostname,
      '--prefix',
      `${location.pathname.slice(1)}${table}/`,
    ]).Contents ?? [];
  const data = objects.filter((object) => object.Size > 0);
  assert.ok(
    data.some((object) => object.Key.endsWith('.parquet')),
    `${table}: falta Parquet`,
  );
  assert.ok(
    data.every((object) => object.Key.endsWith('.parquet')),
    `${table}: salida no Parquet`,
  );
  evidence.parquet[table] = data.map((object) => `s3://${location.hostname}/${object.Key}`);
}
evidence.curatedCrawl = await crawl(outputs.CuratedCrawlerName);
evidence.curatedTables = catalog(outputs.CuratedDatabaseName, expectedTables, 'parquet');

const sql = Object.keys(expectedTables)
  .map(
    (table) =>
      `SELECT '${table}' AS table_name, count(*) AS row_count FROM "${outputs.CuratedDatabaseName}"."${table}"`,
  )
  .join(' UNION ALL ');
const queryId = aws([
  'athena',
  'start-query-execution',
  '--work-group',
  outputs.AthenaWorkGroupName,
  '--query-string',
  sql,
]).QueryExecutionId;
evidence.athenaQuery = await waitFor(
  `Athena/${queryId}`,
  () => {
    const query = aws([
      'athena',
      'get-query-execution',
      '--query-execution-id',
      queryId,
    ]).QueryExecution;
    return { state: query.Status.State, details: query };
  },
  'SUCCEEDED',
  ['FAILED', 'CANCELLED'],
  5 * 60_000,
);
evidence.rowCounts = {};
const result = aws(['athena', 'get-query-results', '--query-execution-id', queryId]);
for (const row of result.ResultSet.Rows.slice(1)) {
  const [table, count] = row.Data.map((cell) => cell.VarCharValue);
  assert.equal(
    Number(count),
    expectedTables[table].rows,
    `${table}: CSV y Parquet deben conservar filas`,
  );
  evidence.rowCounts[table] = Number(count);
}
assert.equal(Object.keys(evidence.rowCounts).length, 6);
const evidencePath = `${appDirectory}cdk.out/glue-demo-evidence.json`;
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`CSV -> Parquet verificado para seis tablas. Evidencia: ${evidencePath}`);
