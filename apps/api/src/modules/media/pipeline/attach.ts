import type { MediaFilter } from './types.js';
import { getRequired } from './types.js';

export const attachImage: MediaFilter = async (context) => {
  const imagePath = getRequired(context.imagePath, 'la ruta de la imagen completa');
  const thumbPath = getRequired(context.thumbPath, 'la ruta de la miniatura');

  context.imageUrl = `/uploads/${imagePath}`;
  context.thumbUrl = `/uploads/${thumbPath}`;
};
