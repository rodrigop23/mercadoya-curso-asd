import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { MediaFilter, SupportedImageMime } from './types.js';
import { getRequired } from './types.js';

const uploadsDirectory = fileURLToPath(new URL('../../../../uploads/media/', import.meta.url));

const extensionByMimeType: Record<SupportedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const persistImage: MediaFilter = async (context) => {
  const contentType = getRequired(context.contentType, 'el tipo MIME');
  const fullImageBytes = getRequired(context.fullImageBytes, 'la imagen redimensionada');
  const thumbImageBytes = getRequired(context.thumbImageBytes, 'la miniatura redimensionada');
  const assetId = randomUUID();
  const extension = extensionByMimeType[contentType];
  const imagePath = `media/${assetId}-full.${extension}`;
  const thumbPath = `media/${assetId}-thumb.${extension}`;
  const fullImageFile = new URL(`../../../../uploads/${imagePath}`, import.meta.url);
  const thumbImageFile = new URL(`../../../../uploads/${thumbPath}`, import.meta.url);
  let fullImageWasSaved = false;

  await mkdir(uploadsDirectory, { recursive: true });

  try {
    await writeFile(fullImageFile, fullImageBytes, { flag: 'wx' });
    fullImageWasSaved = true;
    await writeFile(thumbImageFile, thumbImageBytes, { flag: 'wx' });
  } catch (error) {
    if (fullImageWasSaved) {
      await unlink(fullImageFile).catch(() => undefined);
    }

    throw error;
  }

  context.imagePath = imagePath;
  context.thumbPath = thumbPath;
};

export async function removePersistedImage(imagePath: string, thumbPath: string) {
  const fullImageFile = new URL(`../../../../uploads/${imagePath}`, import.meta.url);
  const thumbImageFile = new URL(`../../../../uploads/${thumbPath}`, import.meta.url);

  await Promise.all([
    unlink(fullImageFile).catch(() => undefined),
    unlink(thumbImageFile).catch(() => undefined),
  ]);
}
