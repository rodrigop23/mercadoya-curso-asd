import { InvalidMediaError } from '../contract.js';
import type { MediaFilter, SupportedImageMime } from './types.js';
import { maxImageSizeBytes } from './types.js';

const allowedMimeTypes = new Set<SupportedImageMime>(['image/jpeg', 'image/png', 'image/webp']);

function matchesSignature(bytes: Buffer, contentType: SupportedImageMime) {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (contentType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }

  return (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  );
}

export const validateImage: MediaFilter = async (context) => {
  const { file } = context;

  if (file.size === 0) {
    throw new InvalidMediaError('El archivo de imagen está vacío.');
  }

  if (file.size > maxImageSizeBytes) {
    throw new InvalidMediaError('La imagen no puede superar los 2 MB.');
  }

  if (!allowedMimeTypes.has(file.type as SupportedImageMime)) {
    throw new InvalidMediaError('La imagen debe ser JPG, PNG o WebP.');
  }

  const contentType = file.type as SupportedImageMime;
  const bytes = Buffer.from(await file.arrayBuffer());

  if (!matchesSignature(bytes, contentType)) {
    throw new InvalidMediaError(
      'El contenido del archivo no coincide con una imagen JPG, PNG o WebP.',
    );
  }

  context.contentType = contentType;
  context.bytes = bytes;
};
