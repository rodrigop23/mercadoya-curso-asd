import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

const functionName = 'mercadoya-notifications';

export class NotificationsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const invokeToken = new CfnParameter(this, 'NotificationsInvokeToken', {
      type: 'String',
      noEcho: true,
      description: 'Token que el bridge envía a la Function URL.',
    });
    const resendKey = new CfnParameter(this, 'ResendApiKey', {
      type: 'String',
      noEcho: true,
      default: '',
      description: 'API key de Resend; vacío usa stub por defecto.',
    });
    const resendFrom = new CfnParameter(this, 'ResendFrom', {
      type: 'String',
      default: '',
      description: 'Remitente del dominio verificado en Resend.',
    });
    const demoEmail = new CfnParameter(this, 'DemoNotifyEmail', {
      type: 'String',
      default: '',
      description: 'Correo destinatario de la demo.',
    });
    const emailMode = new CfnParameter(this, 'EmailMode', {
      type: 'String',
      default: '',
      allowedValues: ['', 'stub', 'resend'],
      description: 'Vacío elige resend con key o stub sin key.',
    });
    const logGroup = new logs.LogGroup(this, 'NotificationsLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const notification = new nodejs.NodejsFunction(this, 'Notifications', {
      depsLockFilePath: join(projectRoot, '../../pnpm-lock.yaml'),
      entry: join(projectRoot, 'src/handler.ts'),
      handler: 'handler',
      functionName,
      runtime: lambda.Runtime.NODEJS_22_X,
      logGroup,
      memorySize: 256,
      timeout: Duration.seconds(20),
      environment: {
        NOTIFICATIONS_INVOKE_TOKEN: invokeToken.valueAsString,
        RESEND_API_KEY: resendKey.valueAsString,
        RESEND_FROM: resendFrom.valueAsString,
        DEMO_NOTIFY_EMAIL: demoEmail.valueAsString,
        EMAIL_MODE: emailMode.valueAsString,
      },
      bundling: { externalModules: [], minify: true, sourceMap: true, target: 'node22' },
    });
    const url = notification.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    new CfnOutput(this, 'FunctionUrl', { value: url.url });
    new CfnOutput(this, 'FunctionName', { value: notification.functionName });
    new CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName });
    new CfnOutput(this, 'AccountId', { value: Stack.of(this).account });
    new CfnOutput(this, 'Region', { value: Stack.of(this).region });
  }
}
