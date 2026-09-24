import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { ChevronDownIcon, LogOutIcon } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';
import '../styles.css';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  const { data: session, isPending } = authClient.useSession();
  const isAdmin = session
    ? (session.user as typeof session.user & { role?: string | null }).role === 'admin'
    : false;
  const userName = session?.user.name?.trim() || session?.user.email || 'Usuario';
  const userInitial = Array.from(userName)[0]?.toLocaleUpperCase() ?? '?';

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
            {isAdmin && (
              <Link
                to="/admin/products"
                className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                activeProps={{ className: 'bg-emerald-50 text-primary' }}
              >
                Administración
              </Link>
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {isPending ? (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                Revisando sesión…
              </span>
            ) : session ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="rounded-full"
                      aria-label={`Abrir el menú de cuenta de ${userName}`}
                    />
                  }
                >
                  <Avatar>
                    <AvatarFallback>{userInitial}</AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="flex items-center gap-2">
                      <Avatar>
                        <AvatarFallback>{userInitial}</AvatarFallback>
                      </Avatar>
                      <span className="grid min-w-0 text-sm leading-tight">
                        <span className="truncate font-semibold text-foreground">
                          {userName}
                        </span>
                        <span className="truncate text-xs font-normal text-muted-foreground">
                          {session.user.email}
                        </span>
                      </span>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => void authClient.signOut()}
                      className="cursor-pointer"
                    >
                      <LogOutIcon data-icon="inline-start" />
                      Cerrar sesión
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="lg" className="font-semibold" />}>
                  Cuenta
                  <ChevronDownIcon data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem render={<Link to="/login" />} className="cursor-pointer">
                      Ingresar
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link to="/register" />} className="cursor-pointer">
                      Registrarse
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
