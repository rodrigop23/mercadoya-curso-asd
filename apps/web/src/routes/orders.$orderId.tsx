import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { EventTimeline } from '@/components/event-timeline';
import { eventsQueryOptions } from '@/lib/events';
import { orderQueryOptions } from '@/lib/orders';
import { productsQueryOptions } from '@/lib/products';

export const Route = createFileRoute('/orders/$orderId')({ component: OrderPage });

const statusLabels = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  rejected: 'Rechazado',
} as const;

const statusClasses = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  rejected: 'bg-red-50 text-red-800 ring-red-200',
} as const;

const rejectionReasons: Record<string, string> = {
  invalid_quantity: 'La cantidad solicitada no es válida.',
  product_not_found: 'El producto ya no está disponible.',
  insufficient_stock: 'No hay stock suficiente para completar el pedido.',
  stock_limit: 'La reserva supera el límite de stock del producto.',
};

const dateFormatter = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function OrderPage() {
  const { orderId } = Route.useParams();
  const queryClient = useQueryClient();
  const orderQuery = useQuery(orderQueryOptions(orderId));
  const order = orderQuery.data;
  const productsQuery = useQuery(productsQueryOptions);
  const product = productsQuery.data?.find((item) => item.id === order?.productId);
  const eventsQuery = useQuery({
    ...eventsQueryOptions({
      limit: 100,
      orderId,
      refetchInterval: order?.status === 'pending' ? 750 : false,
    }),
    enabled: Boolean(order),
  });

  useEffect(() => {
    if (order?.status === 'confirmed') {
      void queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
    }

    if (order?.status === 'confirmed' || order?.status === 'rejected') {
      void queryClient.invalidateQueries({
        queryKey: ['events', { limit: 100, orderId }],
      });
    }
  }, [order?.status, orderId, queryClient]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/catalog" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        <ArrowLeft data-icon="inline-start" />
        Volver al catálogo
      </Link>

      <div className="mt-6 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Estado del pedido</h1>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground sm:text-sm">
          {orderId}
        </p>
      </div>

      {orderQuery.isPending ? (
        <Card className="mt-8 max-w-3xl">
          <CardContent className="space-y-4 p-6">
            <div className="h-4 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-8 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </CardContent>
        </Card>
      ) : orderQuery.error || !order ? (
        <Card className="mt-8 max-w-3xl border-red-200">
          <CardContent className="flex items-start gap-3 p-6">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">No se pudo encontrar el pedido</h2>
              <p role="alert" className="mt-1 text-sm leading-6 text-muted-foreground">
                {orderQuery.error?.message ??
                  'Comprueba el enlace o crea un pedido desde el catálogo.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mt-8 max-w-3xl shadow-sm">
            <CardHeader className="gap-3 border-b border-border/70 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Resumen</h2>
                  <CardDescription className="mt-1">
                    Pedido creado el {formatDate(order.createdAt)}
                  </CardDescription>
                </div>
                <OrderStatus status={order.status} />
              </div>
            </CardHeader>
            <CardContent className="px-5 py-5 sm:px-6">
              {order.status === 'pending' ? (
                <div className="flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 text-amber-950">
                  <LoaderCircle
                    className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold">Confirmando stock…</p>
                    <p className="mt-1 text-sm leading-5 text-amber-900">
                      Inventory está procesando la reserva. Esta página se actualizará sola.
                    </p>
                  </div>
                </div>
              ) : order.status === 'confirmed' ? (
                <div className="flex items-start gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-950">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">Stock reservado</p>
                    <p className="mt-1 text-sm leading-5 text-emerald-900">
                      El pedido quedó confirmado y el catálogo muestra el stock actualizado.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg bg-red-50 px-4 py-3 text-red-950">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">No se pudo reservar el stock</p>
                    <p className="mt-1 text-sm leading-5 text-red-900">
                      {order.rejectionReason
                        ? (rejectionReasons[order.rejectionReason] ?? order.rejectionReason)
                        : 'El inventario rechazó este pedido.'}
                    </p>
                  </div>
                </div>
              )}

              <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">Producto</dt>
                  <dd className="mt-1 truncate text-sm font-semibold">
                    {product?.title ?? 'Producto'}
                  </dd>
                  <dd className="mt-1 break-all font-mono text-[10px] leading-4 text-muted-foreground">
                    {order.productId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Unidades</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">{order.quantity}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Stock actual</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">
                    {product ? `${product.stock} unidades` : 'Sin datos'}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="mt-6 shadow-sm">
            <CardHeader className="border-b border-border/70 px-5 py-5 sm:px-6">
              <h2 className="text-base font-semibold">Event timeline</h2>
              <CardDescription className="mt-1">
                Publish y consume del bus, en orden de proceso y filtrados por este pedido.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 py-6 sm:px-6">
              <EventTimeline
                events={eventsQuery.data ? [...eventsQuery.data].reverse() : []}
                isLoading={eventsQuery.isPending || eventsQuery.isFetching}
                error={eventsQuery.error}
                emptyTitle="Aún no hay eventos para este pedido"
                emptyMessage="El API guarda la traza reciente en memoria. Vuelve a consultar mientras Inventory procesa la reserva."
              />
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

function OrderStatus({ status }: { status: keyof typeof statusLabels }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${statusClasses[status]}`}
    >
      <span
        className={`size-1.5 rounded-full bg-current ${status === 'pending' ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        aria-hidden="true"
      />
      {statusLabels[status]}
    </span>
  );
}
