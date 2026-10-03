import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Clock } from 'lucide-react';

import { Button, buttonVariants } from '@mercadoya/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@mercadoya/ui/components/card';
import { Separator } from '@mercadoya/ui/components/separator';
import { Spinner } from '@mercadoya/ui/components/spinner';
import { authClient } from '@/lib/auth-client';
import { OrderRequestError, ordersQueryOptions, type Order } from '@/lib/orders';
import { priceFormatter } from '@/lib/products';

export const Route = createFileRoute('/orders/')({ component: OrdersPage });

const dateFormatter = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const statuses = {
  pending: { label: 'Pendiente', icon: Clock },
  confirmed: { label: 'Confirmado', icon: CheckCircle2 },
  rejected: { label: 'Rechazado', icon: CircleAlert },
};

function OrdersPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const ordersQuery = useQuery({
    ...ordersQueryOptions(session?.user.id ?? ''),
    enabled: Boolean(session) && !sessionPending,
  });
  const sessionExpired =
    ordersQuery.error instanceof OrderRequestError && ordersQuery.error.status === 401;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/catalog" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        <ArrowLeft data-icon="inline-start" />
        Volver al catálogo
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Mis pedidos</h1>
      <p className="mt-2 text-muted-foreground">
        Consulta tus pedidos, del más reciente al más antiguo.
      </p>

      {sessionPending ? (
        <LoadingOrders label="Revisando sesión…" />
      ) : !session || sessionExpired ? (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Inicia sesión para ver tus pedidos</CardTitle>
            <CardDescription>Ingresa con la cuenta que usaste al comprar.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/login" className={buttonVariants()}>
              Ingresar
            </Link>
          </CardContent>
        </Card>
      ) : ordersQuery.isPending ? (
        <LoadingOrders label="Cargando tus pedidos…" />
      ) : ordersQuery.isError ? (
        <Card className="mt-8" role="alert">
          <CardHeader>
            <CardTitle>No se pudieron cargar tus pedidos</CardTitle>
            <CardDescription>Comprueba tu conexión y vuelve a intentarlo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => void ordersQuery.refetch()}
              disabled={ordersQuery.isFetching}
            >
              {ordersQuery.isFetching ? 'Reintentando…' : 'Reintentar'}
            </Button>
          </CardContent>
        </Card>
      ) : ordersQuery.data.length === 0 ? (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Todavía no tienes pedidos</CardTitle>
            <CardDescription>
              Cuando realices una compra, podrás consultar su estado aquí.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/catalog" className={buttonVariants()}>
              Explorar el catálogo
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8">
          <p className="mb-3 text-sm text-muted-foreground">Importes antes de impuestos.</p>
          <Card className="gap-0 py-0">
            <ol aria-label="Historial de pedidos">
              {ordersQuery.data.map((order, index) => (
                <li key={order.id}>
                  {index > 0 && <Separator />}
                  <OrderRow order={order} />
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </main>
  );
}

function LoadingOrders({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
      {label}
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  const status = statuses[order.status];
  const StatusIcon = status.icon;
  const quantity = order.items?.reduce((sum, item) => sum + item.quantity, 0) ?? order.quantity;
  const title = order.items?.length
    ? order.items.map((item) => item.title).join(', ')
    : `${quantity} ${quantity === 1 ? 'unidad' : 'unidades'}`;

  return (
    <Link
      to="/orders/$orderId"
      params={{ orderId: order.id }}
      className="grid gap-4 p-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6 sm:p-6"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">Pedido #{order.id.slice(0, 8)}</p>
        <p className="mt-1 break-words text-sm">{title}</p>
        <time dateTime={order.createdAt} className="mt-2 block text-xs text-muted-foreground">
          {dateFormatter.format(new Date(order.createdAt))}
        </time>
      </div>
      <span className="flex items-center gap-2 text-sm">
        <StatusIcon className="size-4 shrink-0" aria-hidden="true" />
        {status.label}
      </span>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <span className="text-sm font-semibold tabular-nums">
          {order.totalAmount != null
            ? priceFormatter.format(order.totalAmount / 100)
            : 'Importe no disponible'}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Ver estado del pedido</span>
      </div>
    </Link>
  );
}
