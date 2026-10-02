import { createFileRoute } from '@tanstack/react-router';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { AdminAccessGuard } from '@/features/identity/admin-access-guard';
import { API_BASE_URL } from '@/lib/products';

export const Route = createFileRoute('/admin/products')({ component: AdminProductsPage });
const CatalogSlice = lazy(() => import('catalog/AdminProducts'));

class CatalogBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <main className="mx-auto max-w-6xl px-4 py-12" role="alert">
          <h1 className="text-xl font-semibold">
            El catálogo de administración no está disponible
          </h1>
          <p className="mt-3">Comprueba la conexión e intenta recargar la página.</p>
          <a className="mt-4 inline-block underline" href="/admin/products">
            Recargar catálogo
          </a>
        </main>
      );
    }
    return this.props.children;
  }
}

function AdminProductsPage() {
  return (
    <AdminAccessGuard>
      <CatalogBoundary>
        <Suspense
          fallback={
            <main className="mx-auto max-w-6xl px-4 py-12" role="status">
              Cargando catálogo…
            </main>
          }
        >
          <CatalogSlice apiBaseUrl={API_BASE_URL} />
        </Suspense>
      </CatalogBoundary>
    </AdminAccessGuard>
  );
}
