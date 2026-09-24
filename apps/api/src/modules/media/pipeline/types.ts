export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type MediaPipelineContext = {
  file: File;
  bytes?: Buffer;
  contentType?: SupportedImageMime;
  sanitizedBytes?: Buffer;
  fullImageBytes?: Buffer;
  thumbImageBytes?: Buffer;
  imagePath?: string;
  thumbPath?: string;
  imageUrl?: string;
  thumbUrl?: string;
};

export type MediaFilter = (context: MediaPipelineContext) => Promise<void>;

// Source uploads are limited to 2 MiB.
export const maxImageSizeBytes = 2 * 1024 * 1024;

export function getRequired<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`El filtro Media necesita ${name}.`);
  }

  return value;
}
