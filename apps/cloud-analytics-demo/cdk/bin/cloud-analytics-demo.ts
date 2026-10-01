import { App } from 'aws-cdk-lib';
import { CloudAnalyticsDemoStack } from '../lib/cloud-analytics-demo-stack.js';

const app = new App();

new CloudAnalyticsDemoStack(app, 'CloudAnalyticsDemoStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
