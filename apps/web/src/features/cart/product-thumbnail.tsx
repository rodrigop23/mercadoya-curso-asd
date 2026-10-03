import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { productImageUrl } from '@/lib/products';

export function ProductThumbnail({ path, title }: { path: string | null; title: string }) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  return path && path !== failedPath ? (
    <img
      src={productImageUrl(path)}
      alt={title}
      width={80}
      height={80}
      loading="lazy"
      onError={() => setFailedPath(path)}
      className="size-20 shrink-0 rounded-lg bg-muted object-cover"
    />
  ) : (
    <span
      className="grid size-20 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
      role="img"
      aria-label={`Sin miniatura de ${title}`}
    >
      <ImageOff className="size-5" aria-hidden="true" />
    </span>
  );
}
