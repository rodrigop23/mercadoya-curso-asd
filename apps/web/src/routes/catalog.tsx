import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, PackageOpen, ShoppingCart } from 'lucide-react';
import { z } from 'zod';
import { productsQuerySchema } from '@mercadoya/contracts';

import { Button, buttonVariants } from '@mercadoya/ui/components/button';
import { Card, CardContent } from '@mercadoya/ui/components/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mercadoya/ui/components/field';
import { Input } from '@mercadoya/ui/components/input';
import { useCart } from '@/features/cart/cart-context';
import { QuantityControl } from '@/features/cart/quantity-control';
import {
  priceFormatter,
  productImageUrl,
  productsQueryOptions,
  type Product,
} from '@/lib/products';

// TanStack Router interpreta los valores numéricos de la URL antes de validateSearch.
const searchStringSchema = z
  .preprocess((value) => (typeof value === 'number' ? String(value) : value), z.string().optional())
  .catch(undefined);
const catalogSearchSchema = z.object({
  q: searchStringSchema,
  minPrice: searchStringSchema,
  maxPrice: searchStringSchema,
});

export const Route = createFileRoute('/catalog')({
  validateSearch: catalogSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps, cause }) => {
    const filters = productsQuerySchema.safeParse(deps);
    const query = queryClient.ensureQueryData(
      productsQueryOptions(filters.success ? filters.data : {}),
    );
    // Las actualizaciones las observa useQuery, que conserva el listado mientras carga.
    if (cause === 'stay') {
      void query.catch(() => undefined);
      return;
    }
    return query;
  },
  component: CatalogPage,
});

function CatalogPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [inputs, setInputs] = useState({
    q: search.q ?? '',
    minPrice: search.minPrice ?? '',
    maxPrice: search.maxPrice ?? '',
  });
  const [previousSearch, setPreviousSearch] = useState(search);
  if (
    previousSearch.q !== search.q ||
    previousSearch.minPrice !== search.minPrice ||
    previousSearch.maxPrice !== search.maxPrice
  ) {
    setPreviousSearch(search);
    setInputs({
      q: search.q ?? '',
      minPrice: search.minPrice ?? '',
      maxPrice: search.maxPrice ?? '',
    });
  }
  const filters = productsQuerySchema.safeParse(search);
  const {
    data: products = [],
    isFetching,
    isPlaceholderData,
  } = useQuery({
    ...productsQueryOptions(filters.success ? filters.data : {}),
    placeholderData: keepPreviousData,
    throwOnError: true,
  });
  const validation = productsQuerySchema.safeParse(inputs);
  const hasFilters = Object.values(search).some((value) => value !== undefined && value !== '');
  const errors = validation.success ? [] : validation.error.issues;
  const priceInvalid = errors.some((issue) => issue.path[0] !== 'q');

  useEffect(() => {
    const result = productsQuerySchema.safeParse(inputs);
    if (!result.success) return;
    const nextSearch = {
      ...(result.data.q ? { q: result.data.q } : {}),
      ...(result.data.minPrice !== undefined ? { minPrice: result.data.minPrice } : {}),
      ...(result.data.maxPrice !== undefined ? { maxPrice: result.data.maxPrice } : {}),
    };
    if (
      nextSearch.q === search.q &&
      (nextSearch.minPrice === undefined ? undefined : String(nextSearch.minPrice)) ===
        search.minPrice &&
      (nextSearch.maxPrice === undefined ? undefined : String(nextSearch.maxPrice)) ===
        search.maxPrice
    )
      return;
    const timeout = window.setTimeout(() => {
      void navigate({ search: nextSearch, replace: true });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [inputs, search.q, search.minPrice, search.maxPrice, navigate]);

  function clearFilters() {
    setInputs({ q: '', minPrice: '', maxPrice: '' });
    void navigate({ search: {}, replace: true });
  }

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

      <form
        className="mt-8"
        aria-label="Filtrar catálogo"
        onSubmit={(event) => event.preventDefault()}
      >
        <FieldGroup className="grid grid-cols-2 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
          <Field
            className="col-span-2 sm:col-span-1"
            data-invalid={errors.some((issue) => issue.path[0] === 'q')}
          >
            <FieldLabel htmlFor="catalog-search">Buscar productos</FieldLabel>
            <Input
              id="catalog-search"
              type="search"
              placeholder="Nombre o descripción"
              maxLength={100}
              value={inputs.q}
              aria-invalid={errors.some((issue) => issue.path[0] === 'q')}
              aria-describedby={errors.length ? 'catalog-filter-error' : undefined}
              onChange={(event) => setInputs((current) => ({ ...current, q: event.target.value }))}
            />
          </Field>
          <Field data-invalid={priceInvalid}>
            <FieldLabel htmlFor="catalog-min-price">Precio mín. (S/)</FieldLabel>
            <Input
              id="catalog-min-price"
              type="number"
              step="0.01"
              min={0}
              placeholder="0.00"
              value={inputs.minPrice}
              aria-invalid={priceInvalid}
              aria-describedby={priceInvalid ? 'catalog-filter-error' : undefined}
              onChange={(event) =>
                setInputs((current) => ({ ...current, minPrice: event.target.value }))
              }
            />
          </Field>
          <Field data-invalid={priceInvalid}>
            <FieldLabel htmlFor="catalog-max-price">Precio máx. (S/)</FieldLabel>
            <Input
              id="catalog-max-price"
              type="number"
              step="0.01"
              min={0}
              placeholder="Sin límite"
              value={inputs.maxPrice}
              aria-invalid={priceInvalid}
              aria-describedby={priceInvalid ? 'catalog-filter-error' : undefined}
              onChange={(event) =>
                setInputs((current) => ({ ...current, maxPrice: event.target.value }))
              }
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            className="col-span-2 sm:col-span-1"
            onClick={clearFilters}
          >
            Limpiar
          </Button>
        </FieldGroup>
        <FieldError id="catalog-filter-error" className="mt-3" errors={errors} />
      </form>

      <p role="status" className="sr-only">
        {isFetching ? 'Actualizando productos…' : ''}
      </p>
      {products.length === 0 && !isPlaceholderData ? (
        <Card className="mt-8 max-w-2xl border-dashed border-border bg-card/70 shadow-none">
          <CardContent className="flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
              <PackageOpen className="size-6" />
            </span>
            <div className="flex-1">
              <h2 className="font-semibold">
                {hasFilters ? 'Sin resultados' : 'Todavía no hay productos'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {hasFilters
                  ? 'No encontramos productos con esos filtros'
                  : 'Vuelve pronto para explorar lo que ofrece tu mercado local.'}
              </p>
            </div>
            {hasFilters ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            ) : (
              <Link to="/" className={buttonVariants({ variant: 'outline' })}>
                Volver al inicio <ArrowRight data-icon="inline-end" />
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul aria-busy={isFetching} className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
  const cart = useCart();
  const quantity = cart.items.find((item) => item.productId === product.id)?.quantity ?? 0;

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
        <p className="line-clamp-2 flex-1 [overflow-wrap:anywhere] text-sm leading-6 text-muted-foreground">
          {product.description}
        </p>
        <p className="text-xs font-medium text-muted-foreground">
          {product.stock > 0 ? `${product.stock} unidades disponibles` : 'Sin stock por ahora'}
        </p>
        <div className="pt-2">
          {quantity > 0 ? (
            <QuantityControl
              title={product.title}
              quantity={quantity}
              className="w-full"
              disabled={cart.locked}
              increaseDisabled={quantity >= product.stock}
              onDecrease={() =>
                quantity === 1 ? cart.remove(product.id) : cart.setQuantity(product, quantity - 1)
              }
              onIncrease={() => cart.setQuantity(product, quantity + 1)}
            />
          ) : (
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={product.stock === 0 || cart.locked || cart.items.length >= 20}
              onClick={() => cart.setQuantity(product, 1)}
            >
              <ShoppingCart data-icon="inline-start" />
              Agregar al carrito
            </Button>
          )}
          {quantity > product.stock && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              Solo quedan {product.stock} unidades. Ajusta la cantidad en el carrito.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
