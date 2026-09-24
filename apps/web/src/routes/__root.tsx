import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import '../styles.css';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-emerald-950/10 bg-emerald-950 px-4 py-2 text-center text-xs font-medium tracking-wide text-emerald-50 sm:text-sm">
        Lo mejor de tu mercado, a un clic de casa.
      </div>
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-x-3 px-3 sm:flex-nowrap sm:gap-x-5 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2.5 text-foreground no-underline">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
              M
            </span>
            <span className="text-base font-semibold tracking-tight sm:text-lg">MercadoYa</span>
          </Link>

          <nav
            aria-label="Navegación principal"
            className="order-3 flex w-full items-center gap-1 overflow-x-auto border-t border-border/70 py-2 text-sm font-medium sm:order-none sm:w-auto sm:flex-1 sm:overflow-visible sm:border-0 sm:py-0"
          >
            <Link
              to="/catalog"
              className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              activeProps={{ className: 'bg-emerald-50 text-primary' }}
            >
              Catálogo
            </Link>
            <Link
              to="/admin/products"
              className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              activeProps={{ className: 'bg-emerald-50 text-primary' }}
            >
              Administración
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {isPending ? (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                Revisando sesión…
              </span>
            ) : session ? (
              <>
                <span className="hidden max-w-36 truncate text-sm text-muted-foreground md:inline">
                  {session.user.name || session.user.email}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void authClient.signOut()}
                >
                  Salir
                </Button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-3"
                >
                  Ingresar
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-primary px-2.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-3.5"
                >
                  Crear cuenta
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="border-t border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
        MercadoYa · Tu mercado local, más cerca.
      </footer>
    </div>
  );
}
