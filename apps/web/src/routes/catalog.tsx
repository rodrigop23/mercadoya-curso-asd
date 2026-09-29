import { useState } from 'react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, LoaderCircle, PackageOpen, ShoppingCart } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOrder } from '@/lib/orders';
import { productImageUrl, productsQueryOptions, type Product } from '@/lib/products';

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
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ProductCard({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState('1');
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => createOrder({ productId: product.id, quantity: Number(quantity) }),
    onSuccess: (order) => navigate({ to: '/orders/$orderId', params: { orderId: order.id } }),
  });
  const numericQuantity = Number(quantity);
  const quantityIsValid =
    Number.isInteger(numericQuantity) && numericQuantity > 0 && numericQuantity <= product.stock;
  const quantityInputId = `quantity-${product.id}`;

  return (
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
          {product.stock > 0 ? `${product.stock} unidades disponibles` : 'Sin stock por ahora'}
        </p>
        <form
          className="flex items-end gap-3 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (quantityIsValid && !mutation.isPending) mutation.mutate();
          }}
        >
          <div className="w-24 shrink-0 space-y-1.5">
            <Label htmlFor={quantityInputId} className="text-xs text-muted-foreground">
              Unidades
            </Label>
            <Input
              id={quantityInputId}
              type="number"
              min={1}
              max={product.stock}
              step={1}
              value={quantity}
              disabled={product.stock === 0 || mutation.isPending}
              aria-invalid={quantity.length > 0 && !quantityIsValid}
              onChange={(event) => setQuantity(event.currentTarget.value)}
              className="h-9 text-center tabular-nums"
            />
          </div>
          <Button
            type="submit"
            className="h-9 flex-1"
            disabled={product.stock === 0 || !quantityIsValid || mutation.isPending}
          >
            {mutation.isPending ? (
              <LoaderCircle
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ShoppingCart data-icon="inline-start" />
            )}
            {mutation.isPending ? 'Creando pedido…' : 'Comprar'}
          </Button>
        </form>
        {mutation.error && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            {mutation.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
