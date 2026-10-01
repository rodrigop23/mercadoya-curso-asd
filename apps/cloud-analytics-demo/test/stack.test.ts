import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import {
  CloudAnalyticsDemoStack,
  DEMO_NAME,
  JOB_LOG_PREFIX,
  PREFIXES,
  SEED_TABLES,
} from '../cdk/lib/cloud-analytics-demo-stack.js';

const stack = new CloudAnalyticsDemoStack(new App(), 'TestAnalyticsStack', {
  env: { account: '111122223333', region: 'us-east-1' },
});
const template = Template.fromStack(stack);
type Statement = {
  Action: string | string[];
  Resource: unknown;
  Effect: string;
  Condition?: unknown;
};

function roleStatements(role: iam.Role): Statement[] {
  const roleRef = stack.resolve(role.roleName);
  const policy = Object.values(template.findResources('AWS::IAM::Policy')).find((resource) =>
    resource.Properties.Roles.some(
      (ref: unknown) => JSON.stringify(ref) === JSON.stringify(roleRef),
    ),
  );
  assert.ok(policy, 'Role must have an execution policy');
  return policy.Properties.PolicyDocument.Statement;
}

function resourcesFor(statements: Statement[], action: string): unknown[] {
  return statements
    .filter((statement) => [statement.Action].flat().includes(action))
    .flatMap((statement) => [statement.Resource].flat());
}

test('data zones are distinct private encrypted buckets with HTTPS and demo tags', () => {
  template.resourceCountIs('AWS::S3::Bucket', 3);
  const buckets = [stack.rawBucket, stack.curatedBucket, stack.artifactsBucket];
  assert.equal(
    new Set(buckets.map((bucket) => JSON.stringify(stack.resolve(bucket.bucketName)))).size,
    3,
  );
  for (const resource of Object.values(template.findResources('AWS::S3::Bucket'))) {
    assert.equal(resource.DeletionPolicy, 'Delete');
    assert.deepEqual(resource.Properties.PublicAccessBlockConfiguration, {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    assert.equal(
      resource.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0]
        .ServerSideEncryptionByDefault.SSEAlgorithm,
      'AES256',
    );
    assert.ok(
      resource.Properties.Tags.some(
        (tag: { Key: string; Value: string }) => tag.Key === 'Session' && tag.Value === '06',
      ),
    );
  }
  template.resourceCountIs('AWS::S3::BucketPolicy', 3);
  for (const resource of Object.values(template.findResources('AWS::S3::BucketPolicy'))) {
    assert.ok(
      resource.Properties.PolicyDocument.Statement.some(
        (statement: Statement) =>
          statement.Effect === 'Deny' &&
          JSON.stringify(statement.Condition) ===
            JSON.stringify({ Bool: { 'aws:SecureTransport': 'false' } }),
      ),
    );
  }
});

test('crawler reads both zones and registers tables without writing S3 or deleting metadata', () => {
  const statements = roleStatements(stack.crawlerRole);
  assert.deepEqual(
    resourcesFor(statements, 's3:GetObject'),
    stack.resolve([
      stack.rawBucket.arnForObjects(`${PREFIXES.raw}*`),
      stack.curatedBucket.arnForObjects(`${PREFIXES.curated}*`),
    ]),
  );
  for (const action of [
    's3:PutObject',
    's3:DeleteObject',
    'glue:DeleteTable',
    'glue:DeletePartition',
  ]) {
    assert.deepEqual(resourcesFor(statements, action), []);
  }
  assert.ok(resourcesFor(statements, 'glue:CreateTable').length > 0);
  assert.ok(resourcesFor(statements, 'glue:BatchCreatePartition').length > 0);
});

test('job overwrites curated and temp without modifying raw, scripts or catalog', () => {
  const statements = roleStatements(stack.jobRole);
  const writable = stack.resolve([
    stack.curatedBucket.arnForObjects(`${PREFIXES.curated}*`),
    stack.artifactsBucket.arnForObjects(`${PREFIXES.temp}*`),
  ]);
  for (const action of ['s3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload']) {
    assert.deepEqual(resourcesFor(statements, action), writable);
  }
  assert.deepEqual(resourcesFor(statements, 'glue:CreateTable'), []);
  assert.deepEqual(resourcesFor(statements, 'glue:UpdateTable'), []);
});

test('Athena reads curated only and writes only results for its own workgroup', () => {
  const [policy] = Object.values(template.findResources('AWS::IAM::ManagedPolicy'));
  const statements: Statement[] = policy.Properties.PolicyDocument.Statement;
  assert.deepEqual(
    resourcesFor(statements, 's3:GetObject'),
    stack.resolve([
      stack.curatedBucket.arnForObjects(`${PREFIXES.curated}*`),
      stack.artifactsBucket.arnForObjects(`${PREFIXES.results}*`),
    ]),
  );
  assert.deepEqual(
    resourcesFor(statements, 's3:PutObject'),
    stack.resolve([stack.artifactsBucket.arnForObjects(`${PREFIXES.results}*`)]),
  );
  assert.deepEqual(
    resourcesFor(statements, 'athena:StartQueryExecution'),
    stack.resolve([
      stack.formatArn({ service: 'athena', resource: `workgroup/${stack.workGroup.ref}` }),
    ]),
  );
  assert.deepEqual(
    resourcesFor(statements, 'glue:GetTable'),
    stack.resolve([
      stack.formatArn({ service: 'glue', resource: 'catalog' }),
      stack.formatArn({ service: 'glue', resource: `database/${stack.curatedDatabase.ref}` }),
      stack.formatArn({ service: 'glue', resource: `table/${stack.curatedDatabase.ref}/*` }),
    ]),
  );
  assert.equal(policy.Properties.Roles, undefined);
  assert.equal(policy.Properties.Users, undefined);
});

test('execution policies scope resources, enumerate actions and restrict bucket listing by prefix', () => {
  for (const type of ['AWS::IAM::Policy', 'AWS::IAM::ManagedPolicy']) {
    for (const resource of Object.values(template.findResources(type))) {
      for (const statement of resource.Properties.PolicyDocument.Statement as Statement[]) {
        assert.equal(statement.Effect, 'Allow');
        assert.ok(![statement.Resource].flat().includes('*'), 'No unscoped resource grants');
        const actions = [statement.Action].flat();
        assert.ok(
          actions.every((action) => !action.includes('*')),
          'No wildcard actions',
        );
        if (actions.includes('s3:ListBucket')) {
          assert.ok(statement.Condition, 'Bucket listing must have a prefix condition');
        }
      }
    }
  }
  template.resourceCountIs('AWS::IAM::Role', 2);
  for (const role of Object.values(template.findResources('AWS::IAM::Role'))) {
    assert.equal(role.Properties.ManagedPolicyArns, undefined);
    assert.deepEqual(role.Properties.AssumeRolePolicyDocument.Statement[0].Principal, {
      Service: 'glue.amazonaws.com',
    });
  }
});

test('workgroup enforces output and encryption with separate databases', () => {
  template.hasResourceProperties('AWS::Athena::WorkGroup', {
    Name: DEMO_NAME,
    RecursiveDeleteOption: true,
    WorkGroupConfiguration: {
      EnforceWorkGroupConfiguration: true,
      EngineVersion: { SelectedEngineVersion: 'Athena engine version 3' },
      ResultConfiguration: {
        OutputLocation: stack.resolve(stack.artifactsBucket.s3UrlForObject(PREFIXES.results)),
        EncryptionConfiguration: { EncryptionOption: 'SSE_S3' },
        ExpectedBucketOwner: '111122223333',
      },
    },
  });
  template.resourceCountIs('AWS::Glue::Database', 2);
  for (const zone of ['raw', 'curated']) {
    template.hasResourceProperties('AWS::Glue::Database', {
      DatabaseInput: Match.objectLike({ Name: `mercadoya_analytics_demo_${zone}` }),
    });
  }
  const outputs = template.toJSON().Outputs;
  assert.ok(outputs.RawLocation);
  assert.ok(outputs.CuratedLocation);
  assert.ok(outputs.AthenaResultsLocation);
});

test('crawlers discover six separate tables with headers and safe schema changes', () => {
  template.resourceCountIs('AWS::Glue::Crawler', 2);
  template.hasResourceProperties('AWS::Glue::Classifier', {
    CsvClassifier: {
      Name: `${DEMO_NAME}-csv`,
      ContainsHeader: 'PRESENT',
      Delimiter: ',',
      QuoteSymbol: '"',
    },
  });
  for (const zone of ['raw', 'curated'] as const) {
    const raw = zone === 'raw';
    const crawler = raw ? stack.rawCrawler : stack.curatedCrawler;
    const properties = template.toJSON().Resources[stack.getLogicalId(crawler)].Properties;
    assert.equal(properties.Name, `${DEMO_NAME}-${zone}`);
    assert.deepEqual(properties.Role, stack.resolve(stack.crawlerRole.roleArn));
    assert.deepEqual(
      properties.DatabaseName,
      stack.resolve((raw ? stack.rawDatabase : stack.curatedDatabase).ref),
    );
    assert.deepEqual(properties.SchemaChangePolicy, {
      UpdateBehavior: 'UPDATE_IN_DATABASE',
      DeleteBehavior: 'LOG',
    });
    assert.equal(JSON.parse(properties.Configuration).Grouping.TableLevelConfiguration, 2);
    assert.deepEqual(
      properties.Targets.S3Targets,
      SEED_TABLES.map((table) => ({
        Path: stack.resolve(
          (raw ? stack.rawBucket : stack.curatedBucket).s3UrlForObject(
            `${PREFIXES[zone]}${table}/${raw ? `${table}.csv` : ''}`,
          ),
        ),
        ...(raw ? {} : { Exclusions: ['**/_*', '**/.*'] }),
      })),
    );
    assert.equal(properties.Classifiers?.length ?? 0, raw ? 1 : 0);
  }
});

test('Glue 5 ETL uses the existing role and paths with a versioned script asset', () => {
  template.resourceCountIs('AWS::Glue::Job', 1);
  template.hasResourceProperties('AWS::Glue::Job', {
    Name: `${DEMO_NAME}-etl`,
    Role: stack.resolve(stack.jobRole.roleArn),
    GlueVersion: '5.0',
    WorkerType: 'G.1X',
    NumberOfWorkers: 2,
    ExecutionProperty: { MaxConcurrentRuns: 1 },
    MaxRetries: 0,
    Timeout: 15,
    Command: {
      Name: 'glueetl',
      PythonVersion: '3',
      ScriptLocation: stack.resolve(
        stack.artifactsBucket.s3UrlForObject(`${PREFIXES.scripts}${stack.etlScript.assetHash}.py`),
      ),
    },
    DefaultArguments: {
      '--job-language': 'python',
      '--TempDir': stack.resolve(stack.artifactsBucket.s3UrlForObject(PREFIXES.temp)),
      '--custom-logGroup-prefix': JOB_LOG_PREFIX,
      '--job-bookmark-option': 'job-bookmark-disable',
      '--RAW_LOCATION': stack.resolve(stack.rawBucket.s3UrlForObject(PREFIXES.raw)),
      '--CURATED_LOCATION': stack.resolve(stack.curatedBucket.s3UrlForObject(PREFIXES.curated)),
    },
  });
  const outputs = template.toJSON().Outputs;
  assert.deepEqual(
    outputs.GlueScriptAssetLocation.Value,
    stack.resolve(stack.etlScript.s3ObjectUrl),
  );
  for (const name of [
    'RawCrawlerName',
    'CuratedCrawlerName',
    'GlueJobName',
    'GlueScriptLocation',
  ]) {
    assert.ok(outputs[name]);
  }
  assert.equal(Object.keys(template.findResources('AWS::Glue::Table')).length, 0);
});
