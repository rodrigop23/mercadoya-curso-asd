import { createNotificationsRoutes } from './routes.js';

export type { NotificationSenderPort } from './ports.js';

export function createNotificationsModule() {
  return { routes: createNotificationsRoutes() };
}
