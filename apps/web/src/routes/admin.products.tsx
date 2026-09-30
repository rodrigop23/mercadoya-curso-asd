import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { AdminAccessGuard } from '@/features/identity/admin-access-guard';

export const Route = createFileRoute('/admin/products')({ component: AdminProductsPage });

const remoteUrl = (import.meta.env.VITE_MF_CATALOG_URL ?? 'http://localhost:5174').replace(
  /\/$/,
  '',
);

function AdminProductsPage() {
  const [height, setHeight] = useState(900);
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!frame) return;
    const origin = new URL(remoteUrl).origin;
    function resize(event: MessageEvent) {
      if (event.source !== frame?.contentWindow || event.origin !== origin) return;
      if (event.data?.type !== 'mercadoya:catalog-height') return;
      const nextHeight = event.data.height;
      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
        setHeight(Math.max(600, Math.min(nextHeight, 10000)));
      }
    }
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, [frame]);

  return (
    <AdminAccessGuard>
      <iframe
        ref={setFrame}
        title="Administración de productos"
        src={remoteUrl}
        style={{ display: 'block', width: '100%', height, border: 0 }}
      />
    </AdminAccessGuard>
  );
}
