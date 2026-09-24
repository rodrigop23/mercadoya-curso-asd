export interface NotificationSenderPort {
  send(input: { recipient: string; subject: string; body: string }): Promise<void>;
}
