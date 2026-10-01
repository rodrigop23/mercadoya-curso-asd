import { ArnFormat, CfnOutput, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export const DEMO_NAME = 'mercadoya-cloud-analytics-demo';
export const PREFIXES = {
  raw: 'raw/',
  curated: 'curated/',
  scripts: 'glue/scripts/',
  temp: 'glue/temp/',
  results: 'athena-results/',
} as const;
export const JOB_LOG_PREFIX = `/aws-glue/${DEMO_NAME}`;

const CATALOG_READ_ACTIONS = [
  'glue:GetDatabase',
  'glue:GetTables',
  'glue:GetTable',
  'glue:GetPartition',
  'glue:GetPartitions',
  'glue:BatchGetPartition',
];

export class CloudAnalyticsDemoStack extends Stack {
  readonly rawBucket: s3.Bucket;
  readonly curatedBucket: s3.Bucket;
  readonly artifactsBucket: s3.Bucket;
  readonly rawDatabase: glue.CfnDatabase;
  readonly curatedDatabase: glue.CfnDatabase;
  readonly crawlerRole: iam.Role;
  readonly jobRole: iam.Role;
  readonly workGroup: athena.CfnWorkGroup;
  readonly athenaQueryPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    Tags.of(this).add('Project', 'MercadoYa');
    Tags.of(this).add('Demo', DEMO_NAME);
    Tags.of(this).add('Session', '06');
    Tags.of(this).add('Environment', 'demo');

    const bucket = (id: string, zone: string) => {
      const resource = new s3.Bucket(this, id, {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      Tags.of(resource).add('DataZone', zone);
      return resource;
    };
    this.rawBucket = bucket('RawBucket', 'raw');
    this.curatedBucket = bucket('CuratedBucket', 'curated');
    this.artifactsBucket = bucket('ArtifactsBucket', 'artifacts');

    this.rawDatabase = new glue.CfnDatabase(this, 'RawDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'mercadoya_analytics_demo_raw',
        description: 'Sesion 6: tablas de los CSV semilla en S3 raw.',
        locationUri: this.rawBucket.s3UrlForObject(PREFIXES.raw),
      },
    });
    this.curatedDatabase = new glue.CfnDatabase(this, 'CuratedDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'mercadoya_analytics_demo_curated',
        description: 'Sesion 6: tablas Parquet producidas por el ETL en S3 curated.',
        locationUri: this.curatedBucket.s3UrlForObject(PREFIXES.curated),
      },
    });

    const catalogResources = (database: glue.CfnDatabase) =>
      ['catalog', `database/${database.ref}`, `table/${database.ref}/*`].map((resource) =>
        this.formatArn({ service: 'glue', resource }),
      );
    const rawCatalog = catalogResources(this.rawDatabase);
    const curatedCatalog = catalogResources(this.curatedDatabase);

    this.crawlerRole = new iam.Role(this, 'CrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      description: 'Crawler del demo: lee raw y curated, registra tablas y particiones.',
    });
    this.jobRole = new iam.Role(this, 'JobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      description: 'ETL del demo: lee raw y scripts, escribe curated y temporales.',
    });

    // ListBucket needs a bucket ARN and a prefix condition, unlike object operations.
    const s3Access = (target: s3.Bucket, prefix: string, actions: string[]) => [
      new iam.PolicyStatement({
        actions: ['s3:GetBucketLocation'],
        resources: [target.bucketArn],
      }),
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [target.bucketArn],
        conditions: { StringLike: { 's3:prefix': [prefix, `${prefix}*`] } },
      }),
      new iam.PolicyStatement({
        actions,
        resources: [target.arnForObjects(`${prefix}*`)],
      }),
    ];
    for (const statement of [
      ...s3Access(this.rawBucket, PREFIXES.raw, ['s3:GetObject']),
      ...s3Access(this.curatedBucket, PREFIXES.curated, ['s3:GetObject']),
      new iam.PolicyStatement({
        actions: [
          ...CATALOG_READ_ACTIONS,
          'glue:CreateTable',
          'glue:UpdateTable',
          'glue:CreatePartition',
          'glue:BatchCreatePartition',
          'glue:UpdatePartition',
        ],
        resources: [...new Set([...rawCatalog, ...curatedCatalog])],
      }),
    ]) {
      this.crawlerRole.addToPolicy(statement);
    }

    const etlWriteActions = [
      's3:GetObject',
      's3:PutObject',
      's3:DeleteObject',
      's3:AbortMultipartUpload',
      's3:ListMultipartUploadParts',
    ];
    for (const statement of [
      ...s3Access(this.rawBucket, PREFIXES.raw, ['s3:GetObject']),
      ...s3Access(this.artifactsBucket, PREFIXES.scripts, ['s3:GetObject']),
      ...s3Access(this.curatedBucket, PREFIXES.curated, etlWriteActions),
      ...s3Access(this.artifactsBucket, PREFIXES.temp, etlWriteActions),
      new iam.PolicyStatement({ actions: CATALOG_READ_ACTIONS, resources: rawCatalog }),
    ]) {
      this.jobRole.addToPolicy(statement);
    }

    // Glue uses a shared crawler group; only this demo's crawler streams are writable.
    const crawlerLogArn = this.formatArn({
      service: 'logs',
      resource: 'log-group',
      resourceName: '/aws-glue/crawlers',
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    this.crawlerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup'],
        resources: [`${crawlerLogArn}:*`],
      }),
    );
    this.crawlerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`${crawlerLogArn}:log-stream:${DEMO_NAME}-*`],
      }),
    );
    for (const suffix of ['error', 'output']) {
      const logGroup = new logs.LogGroup(this, `JobLogs${suffix}`, {
        logGroupName: `${JOB_LOG_PREFIX}/${suffix}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      logGroup.grantWrite(this.jobRole);
    }

    this.workGroup = new athena.CfnWorkGroup(this, 'AthenaWorkGroup', {
      name: DEMO_NAME,
      description: 'Sesion 6: consultas sobre las tablas curated del demo.',
      state: 'ENABLED',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: false,
        engineVersion: { selectedEngineVersion: 'Athena engine version 3' },
        resultConfiguration: {
          outputLocation: this.artifactsBucket.s3UrlForObject(PREFIXES.results),
          expectedBucketOwner: this.account,
          encryptionConfiguration: { encryptionOption: 'SSE_S3' },
        },
      },
    });
    this.athenaQueryPolicy = new iam.ManagedPolicy(this, 'AthenaQueryPolicy', {
      description: 'Consultas del demo: workgroup propio, catalogo curated y resultados S3.',
      statements: [
        new iam.PolicyStatement({
          actions: [
            'athena:GetWorkGroup',
            'athena:StartQueryExecution',
            'athena:StopQueryExecution',
            'athena:GetQueryExecution',
            'athena:BatchGetQueryExecution',
            'athena:ListQueryExecutions',
            'athena:GetQueryResults',
          ],
          resources: [
            this.formatArn({ service: 'athena', resource: `workgroup/${this.workGroup.ref}` }),
          ],
        }),
        new iam.PolicyStatement({ actions: CATALOG_READ_ACTIONS, resources: curatedCatalog }),
        ...s3Access(this.curatedBucket, PREFIXES.curated, ['s3:GetObject']),
        ...s3Access(this.artifactsBucket, PREFIXES.results, [
          's3:GetObject',
          's3:PutObject',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
        ]),
        new iam.PolicyStatement({
          actions: ['s3:ListBucketMultipartUploads'],
          resources: [this.artifactsBucket.bucketArn],
        }),
      ],
    });

    const outputs: Record<string, string> = {
      AccountId: this.account,
      Region: this.region,
      RawBucketName: this.rawBucket.bucketName,
      CuratedBucketName: this.curatedBucket.bucketName,
      ArtifactsBucketName: this.artifactsBucket.bucketName,
      RawLocation: this.rawBucket.s3UrlForObject(PREFIXES.raw),
      CuratedLocation: this.curatedBucket.s3UrlForObject(PREFIXES.curated),
      GlueScriptsLocation: this.artifactsBucket.s3UrlForObject(PREFIXES.scripts),
      GlueTempLocation: this.artifactsBucket.s3UrlForObject(PREFIXES.temp),
      AthenaResultsLocation: this.artifactsBucket.s3UrlForObject(PREFIXES.results),
      RawDatabaseName: this.rawDatabase.ref,
      CuratedDatabaseName: this.curatedDatabase.ref,
      GlueCrawlerRoleArn: this.crawlerRole.roleArn,
      GlueJobRoleArn: this.jobRole.roleArn,
      GlueJobLogGroupPrefix: JOB_LOG_PREFIX,
      AthenaWorkGroupName: this.workGroup.ref,
      AthenaQueryPolicyArn: this.athenaQueryPolicy.managedPolicyArn,
    };
    for (const [name, value] of Object.entries(outputs)) {
      new CfnOutput(this, name, { value });
    }
  }
}
