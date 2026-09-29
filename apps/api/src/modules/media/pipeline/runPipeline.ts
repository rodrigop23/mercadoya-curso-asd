import { InvalidMediaError, type ProductImage } from '../contract.js';
import { attachImage } from './attach.js';
import { persistImage, removePersistedImage } from './persist.js';
import { resizeImage } from './resize.js';
import { sanitizeImage } from './sanitize.js';
import type { MediaFilter, MediaPipelineContext } from './types.js';
import { validateImage } from './validate.js';

const pipelineSteps: Array<[string, MediaFilter]> = [
  ['Validate', validateImage],
  ['Sanitize', sanitizeImage],
  ['Resize', resizeImage],
  ['Persist', persistImage],
  ['Attach', attachImage],
];

export async function runPipeline(file: File): Promise<ProductImage> {
  const context: MediaPipelineContext = { file };

  for (const [name, filter] of pipelineSteps) {
    try {
      await filter(context);
      console.info(`[Media] ${name} ✓`);
    } catch (error) {
      console.error(`[Media] ${name} ✗: ${error instanceof Error ? error.message : String(error)}`);

      if (error instanceof InvalidMediaError) {
        throw error;
      }

      if (context.imagePath && context.thumbPath) {
        await removePersistedImage(context.imagePath, context.thumbPath);
      }

      throw error;
    }
  }

  return {
    imagePath: context.imagePath!,
    thumbPath: context.thumbPath!,
    imageUrl: context.imageUrl!,
    thumbUrl: context.thumbUrl!,
  };
}
