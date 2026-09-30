import sharp from 'sharp';

import { InvalidMediaError } from '../contract.js';
import type { MediaFilter } from './types.js';
import { getRequired } from './types.js';

export const sanitizeImage: MediaFilter = async (context) => {
  const bytes = getRequired(context.bytes, 'los bytes validados');

  try {
    // Re-encoding applies EXIF orientation and drops metadata such as GPS coordinates.
    context.sanitizedBytes = await sharp(bytes, { failOn: 'error' }).rotate().toBuffer();
  } catch {
    throw new InvalidMediaError('El archivo de imagen está dañado o no se puede leer.');
  }
};
