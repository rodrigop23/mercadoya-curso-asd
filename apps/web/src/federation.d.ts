declare module 'catalog/AdminProducts' {
  import type { ComponentType } from 'react';
  const CatalogSlice: ComponentType<{ apiBaseUrl: string }>;
  export default CatalogSlice;
}
