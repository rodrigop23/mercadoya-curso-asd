import { App } from 'aws-cdk-lib';
import { NotificationsStack } from '../lib/notifications-stack.js';

const app = new App();
new NotificationsStack(app, 'NotificationsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
