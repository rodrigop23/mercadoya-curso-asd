import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReactDOM from 'react-dom/client';
import { useEffect, useState } from 'react';

import { AdminProductsContent } from './admin-products';
import { API_BASE_URL } from './lib/products';
import './styles.css';

const queryClient = new QueryClient();

type Access = 'loading' | 'admin' | 'denied' | 'error';

function App() {
  const [access, setAccess] = useState<Access>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/me`, { credentials: 'include', signal: controller.signal })
      .then(async (response): Promise<Access> => {
        if (response.status === 401) return 'denied';
        if (!response.ok) return 'error';
        const body = (await response.json()) as { user?: { role?: string } };
        return body.user?.role === 'admin' ? 'admin' : 'denied';
      })
      .then(setAccess)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('No se pudo verificar la sesión:', error);
          setAccess('error');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (window.parent === window) return;
    const targetOrigin = import.meta.env.VITE_HOST_URL ?? 'http://localhost:5173';
    const observer = new ResizeObserver(() => {
      window.parent.postMessage(
        { type: 'mercadoya:catalog-height', height: document.documentElement.scrollHeight },
        targetOrigin,
      );
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  if (access === 'loading') return <main className="px-4 py-12">Verificando sesión…</main>;
  if (access === 'denied') {
    return (
      <main className="px-4 py-12" role="alert">
        Inicia sesión como administrador en el host para gestionar productos.
      </main>
    );
  }
  if (access === 'error') {
    return (
      <main className="px-4 py-12" role="alert">
        No se pudo verificar la sesión. Comprueba que el API esté disponible.
      </main>
    );
  }
  return <AdminProductsContent />;
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
