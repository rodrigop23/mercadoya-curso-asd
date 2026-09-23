import { createFileRoute } from '@tanstack/react-router';

import { AdminAccessGuard } from '@/features/identity/admin-access-guard';
import { AdminProductForm } from '@/features/catalog/admin-product-form';

export const Route = createFileRoute('/admin/products')({ component: AdminProductsPage });

function AdminProductsPage() {
  return (
    <AdminAccessGuard>
      <AdminProductForm />
    </AdminAccessGuard>
  );
}
