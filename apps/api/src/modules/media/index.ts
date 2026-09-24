import { createMediaRoutes } from './routes.js';
import type { MediaContract } from './contract.js';
import { runPipeline } from './pipeline/runPipeline.js';
import { removePersistedImage } from './pipeline/persist.js';

export { InvalidMediaError, type MediaContract, type ProductImage } from './contract.js';

const mediaContract: MediaContract = {
  processProductImage: runPipeline,
  async deleteProductImage(image) {
    await removePersistedImage(image.imagePath, image.thumbPath);
  },
};

export function createMediaModule() {
  return { routes: createMediaRoutes(), contract: mediaContract };
}
