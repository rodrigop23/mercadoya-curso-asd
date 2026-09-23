import { createFileRoute, Link } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/admin/products')({ component: AdminProductsPage });

function AdminProductsPage() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16 text-sm text-muted-foreground">
        Cargando sesión…
      </main>
    );
  }

  if (!session) {
    return (
      <AdminNotice
        title="Inicia sesión para continuar"
        description="Ingresa con tu cuenta de administración para acceder a esta sección."
        action={
          <Link to="/login" className={buttonVariants()}>
            Ingresar
          </Link>
        }
      />
    );
  }

  const role = (session.user as typeof session.user & { role?: string | null }).role;

  if (role !== 'admin') {
    return (
      <AdminNotice
        title="Acceso de administración"
        description="Esta vista está reservada para cuentas con el rol de administrador."
        action={
          <Link to="/catalog" className={buttonVariants({ variant: 'outline' })}>
            Ir al catálogo
          </Link>
        }
      />
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
          Administración
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Productos</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Aquí estará el espacio para gestionar el catálogo de MercadoYa.
        </p>
      </div>
      <Card className="mt-8 max-w-2xl border-dashed border-border bg-card/70 shadow-none">
        <CardContent className="flex items-start gap-4 p-6 sm:p-8">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
            <ShieldCheck className="size-6" />
          </span>
          <div>
            <h2 className="font-semibold">Panel preparado</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              La gestión de productos se implementará en otra etapa.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

type AdminNoticeProps = {
  title: string;
  description: string;
  action: ReactNode;
};

function AdminNotice({ title, description, action }: AdminNoticeProps) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-10rem)] max-w-6xl items-center px-4 py-12 sm:px-6">
      <Card className="w-full max-w-lg border-border/80 shadow-sm">
        <CardContent className="p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-6">{action}</div>
        </CardContent>
      </Card>
    </main>
  );
}
