import { Link } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

type AdminAccessGuardProps = {
  children: ReactNode;
};

export function AdminAccessGuard({ children }: AdminAccessGuardProps) {
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

  return children;
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
