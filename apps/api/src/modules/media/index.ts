import { createMediaRoutes } from './routes.js';

export type { MediaStoragePort } from './ports.js';

export function createMediaModule() {
  return { routes: createMediaRoutes() };
}
