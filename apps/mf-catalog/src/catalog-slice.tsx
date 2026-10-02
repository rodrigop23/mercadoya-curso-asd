import { createContext, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@mercadoya/ui/components/button';
import { QueryClient } from '@tanstack/react-query';
import { AdminProductsContent } from './admin-products';
import { createCatalogApi } from './lib/products';

const CatalogContext = createContext<ReturnType<typeof createCatalogApi> | null>(null);

export function useCatalogApi() {
  const api = useContext(CatalogContext);
  if (!api) throw new Error('El catálogo requiere configuración del host.');
  return api;
}

export default function CatalogSlice({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => createCatalogApi(apiBaseUrl), [apiBaseUrl]);
  return (
    <CatalogContext.Provider value={api}>
      <AdminProductsContent />
    </CatalogContext.Provider>
  );
}

// Permite comprobar identidad de los singletons desde el smoke y DevTools.
export const runtimeIdentity = { useState, createPortal, Button, QueryClient };
