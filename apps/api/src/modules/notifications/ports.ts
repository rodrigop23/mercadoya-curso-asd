export interface NotificationSenderPort {
  send(input: {
    recipient: string;
    subject: string;
    body: string;
    orderId: string;
    transport: 'nats' | 'inprocess';
  }): Promise<void>;
}
