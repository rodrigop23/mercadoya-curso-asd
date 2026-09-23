import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ShoppingBasket } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export const Route = createFileRoute('/catalog')({ component: CatalogPage });

function CatalogPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Catálogo</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Encuentra algo bueno cerca.
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Estamos preparando los productos de tu mercado local. Pronto podrás explorarlos aquí.
        </p>
      </div>
      <Card className="mt-8 max-w-2xl border-dashed border-border bg-card/70 shadow-none">
        <CardContent className="flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
            <ShoppingBasket className="size-6" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">Próximamente</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              La experiencia de compra y el catálogo llegarán en la siguiente etapa.
            </p>
          </div>
          <Link to="/" className={buttonVariants({ variant: 'outline' })}>
            Volver al inicio <ArrowRight data-icon="inline-end" />
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
