import sharp, { type Sharp } from 'sharp';

import { InvalidMediaError } from '../contract.js';
import type { MediaFilter, SupportedImageMime } from './types.js';
import { getRequired } from './types.js';

function encode(image: Sharp, contentType: SupportedImageMime) {
  if (contentType === 'image/jpeg') {
    return image.jpeg({ quality: 86, mozjpeg: true });
  }

  if (contentType === 'image/png') {
    return image.png({ compressionLevel: 9, palette: true });
  }

  return image.webp({ quality: 86 });
}

export const resizeImage: MediaFilter = async (context) => {
  const bytes = getRequired(context.sanitizedBytes, 'la imagen saneada');
  const contentType = getRequired(context.contentType, 'el tipo MIME');

  try {
    const source = sharp(bytes, { failOn: 'error' });
    const [fullImageBytes, thumbImageBytes] = await Promise.all([
      encode(
        source
          .clone()
          .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }),
        contentType,
      ).toBuffer(),
      encode(
        source
          .clone()
          .resize({
            width: 320,
            height: 320,
            fit: 'cover',
            position: 'attention',
            withoutEnlargement: true,
          }),
        contentType,
      ).toBuffer(),
    ]);

    context.fullImageBytes = fullImageBytes;
    context.thumbImageBytes = thumbImageBytes;
  } catch {
    throw new InvalidMediaError(
      'No se pudo procesar la imagen. Usa un archivo JPG, PNG o WebP válido.',
    );
  }
};
