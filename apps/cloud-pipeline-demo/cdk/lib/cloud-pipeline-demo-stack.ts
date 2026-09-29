import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';

const FUNCTION_NAME = 'mercadoya-cloud-pipeline-demo-processor';
const INPUT_PREFIX = 'inbox/';
const OUTPUT_PREFIX = 'outbox/';

export class CloudPipelineDemoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'PipelineBucket', {
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const logGroup = new logs.LogGroup(this, 'ProcessorLogGroup', {
      logGroupName: `/aws/lambda/${FUNCTION_NAME}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const role = new iam.Role(this, 'ProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Lee inbox/, escribe outbox/ y publica logs para el demo aislado.',
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects(`${INPUT_PREFIX}*`)],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [bucket.arnForObjects(`${OUTPUT_PREFIX}*`)],
      }),
    );
    logGroup.grantWrite(role);

    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const processor = new nodejs.NodejsFunction(this, 'Processor', {
      entry: join(projectRoot, 'lambda/handler.ts'),
      handler: 'handler',
      functionName: FUNCTION_NAME,
      logGroup,
      memorySize: 256,
      role,
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      environment: {
        PIPELINE_BUCKET: bucket.bucketName,
        INPUT_PREFIX,
        OUTPUT_PREFIX,
      },
      bundling: {
        externalModules: [],
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    });

    bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(processor), {
      prefix: INPUT_PREFIX,
    });

    new CfnOutput(this, 'AccountId', {
      description: 'Cuenta AWS donde se desplegó el demo.',
      value: Stack.of(this).account,
    });
    new CfnOutput(this, 'Region', {
      description: 'Región AWS donde se desplegó el demo.',
      value: Stack.of(this).region,
    });
    new CfnOutput(this, 'BucketName', {
      description: 'Bucket con los prefijos inbox/ y outbox/.',
      value: bucket.bucketName,
    });
    new CfnOutput(this, 'FunctionName', {
      description: 'Lambda que procesa los objetos de inbox/.',
      value: processor.functionName,
    });
    new CfnOutput(this, 'LogGroupName', {
      description: 'Grupo CloudWatch Logs de la Lambda.',
      value: logGroup.logGroupName,
    });
  }
}
