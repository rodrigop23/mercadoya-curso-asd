import { App } from 'aws-cdk-lib';
import { CloudPipelineDemoStack } from '../lib/cloud-pipeline-demo-stack.js';

const app = new App();

new CloudPipelineDemoStack(app, 'CloudPipelineDemoStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
