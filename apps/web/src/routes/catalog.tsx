import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, PackageOpen } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { productImageUrl, productsQueryOptions } from '@/lib/products';

export const Route = createFileRoute('/catalog')({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(productsQueryOptions),
  component: CatalogPage,
});

const priceFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
});

function CatalogPage() {
  const { data: products } = useSuspenseQuery(productsQueryOptions);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Encuentra algo bueno cerca.
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Productos disponibles en tu mercado local.
        </p>
      </div>

      {products.length === 0 ? (
        <Card className="mt-8 max-w-2xl border-dashed border-border bg-card/70 shadow-none">
          <CardContent className="flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
              <PackageOpen className="size-6" />
            </span>
            <div className="flex-1">
              <h2 className="font-semibold">Todavía no hay productos</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Vuelve pronto para explorar lo que ofrece tu mercado local.
              </p>
            </div>
            <Link to="/" className={buttonVariants({ variant: 'outline' })}>
              Volver al inicio <ArrowRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <li key={product.id}>
              <Card className="h-full shadow-sm">
                <img
                  src={productImageUrl(product.imagePath)}
                  alt={product.title}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-lg font-semibold leading-snug">{product.title}</h2>
                    <p className="shrink-0 font-semibold text-primary">
                      {priceFormatter.format(product.price)}
                    </p>
                  </div>
                  <p className="line-clamp-3 flex-1 text-sm leading-6 text-muted-foreground">
                    {product.description}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {product.stock > 0
                      ? `${product.stock} unidades disponibles`
                      : 'Sin stock por ahora'}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
