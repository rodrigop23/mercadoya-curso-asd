import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CreditCard, LoaderCircle, ShoppingCart, Trash2 } from 'lucide-react';
import { Button, buttonVariants } from '@mercadoya/ui/components/button';
import { Separator } from '@mercadoya/ui/components/separator';
import { useCart } from '@/features/cart/cart-context';
import { QuantityControl } from '@/features/cart/quantity-control';
import { ProductThumbnail } from '@/features/cart/product-thumbnail';
import { OrderItems } from '@/features/cart/order-items';
import { authClient } from '@/lib/auth-client';
import {
  checkoutQueryOptions,
  createOrder,
  OrderRequestError,
  orderQueryOptions,
} from '@/lib/orders';
import { priceFormatter, productThumbnailPath, productsQueryOptions } from '@/lib/products';

export const Route = createFileRoute('/cart')({ component: CartPage });

function CartPage() {
  const cart = useCart();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const productsQuery = useQuery(productsQueryOptions);
  const orderId = cart.pendingOrderId ?? cart.checkoutKey;
  const orderQuery = useQuery({
    ...orderQueryOptions(orderId ?? ''),
    enabled: Boolean(orderId && session),
    retry: false,
  });
  const order = orderQuery.data;
  const checkoutQuery = useQuery({
    ...checkoutQueryOptions(orderId ?? ''),
    enabled: order?.status === 'pending',
  });
  const checkout = checkoutQuery.data?.checkout;
  const mutation = useMutation({
    mutationFn: () =>
      createOrder({
        items: cart.items.map(({ productId, quantity }) => ({ productId, quantity })),
        idempotencyKey: cart.beginCheckout(),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData(orderQueryOptions(created.id).queryKey, created);
      cart.setPendingOrder(created.id);
    },
    onError: (error) => {
      if (error instanceof OrderRequestError && error.status < 500) cart.releaseCheckout();
      void queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
    },
  });

  const { setPendingOrder, completeOrder, releaseCheckout } = cart;
  useEffect(() => {
    if (!order) return;
    if (order.status === 'confirmed') {
      completeOrder(order);
      void queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
      void navigate({ to: '/orders/$orderId', params: { orderId: order.id } });
    } else if (order.status === 'rejected') {
      releaseCheckout('El pedido no se completó. Revisa las cantidades y vuelve a intentarlo.');
      void queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
    } else setPendingOrder(order.id);
  }, [order, setPendingOrder, completeOrder, releaseCheckout, navigate, queryClient]);

  useEffect(() => {
    if (checkout && order?.status === 'pending' && !cart.redirected) {
      cart.markRedirected();
      window.location.assign(checkout.url);
    }
  }, [checkout, order?.status, cart]);

  const rows = cart.items.map((item) => {
    const product = productsQuery.data?.find((product) => product.id === item.productId);
    return { item, product };
  });
  const totalAmount =
    order?.totalAmount ??
    rows.reduce(
      (sum, { item, product }) =>
        sum + (product ? Math.round(product.price * 100) : item.unitAmount) * item.quantity,
      0,
    );
  const invalidStock = rows.some(({ item, product }) => !product || item.quantity > product.stock);
  const pending = order?.status === 'pending';
  const canPay =
    cart.items.length > 0 &&
    !invalidStock &&
    productsQuery.isSuccess &&
    !mutation.isPending &&
    !sessionPending;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/catalog" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        <ArrowLeft data-icon="inline-start" />
        Seguir comprando
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Tu carrito</h1>
      <p className="mt-3 text-muted-foreground">
        Revisa tus productos y las cantidades antes de pagar.
      </p>
      {cart.items.length === 0 && !pending ? (
        <section className="mt-10 flex max-w-lg flex-col items-start gap-4 rounded-xl border border-dashed border-border p-6 sm:p-8">
          <ShoppingCart className="size-8 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Tu carrito está vacío</h2>
          <p className="text-sm text-muted-foreground">
            Agrega productos del catálogo para preparar tu compra.
          </p>
          <Link to="/catalog" className={buttonVariants()}>
            Explorar catálogo
          </Link>
        </section>
      ) : (
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
          <section aria-label="Productos del carrito" className="min-w-0">
            {pending && order.items ? (
              <OrderItems items={order.items} totalAmount={totalAmount} />
            ) : (
              <ul className="divide-y divide-border">
                {rows.map(({ item, product }) => (
                  <li key={item.productId} className="flex gap-4 py-6 first:pt-0">
                    <ProductThumbnail
                      path={product ? productThumbnailPath(product.imagePath) : item.thumbnailPath}
                      title={product?.title ?? item.title}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-semibold [overflow-wrap:anywhere]">
                          {product?.title ?? item.title}
                        </h2>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          disabled={cart.locked}
                          aria-label={`Eliminar ${item.title} del carrito`}
                          onClick={() => cart.remove(item.productId)}
                        >
                          <Trash2 data-icon="inline-start" />
                        </Button>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {priceFormatter.format(
                          (product ? Math.round(product.price * 100) : item.unitAmount) / 100,
                        )}{' '}
                        por unidad
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <QuantityControl
                          quantity={item.quantity}
                          title={item.title}
                          className="w-36"
                          disabled={cart.locked}
                          decreaseDisabled={!product && item.quantity > 1}
                          increaseDisabled={!product || item.quantity >= product.stock}
                          onDecrease={() =>
                            item.quantity === 1
                              ? cart.remove(item.productId)
                              : product && cart.setQuantity(product, item.quantity - 1)
                          }
                          onIncrease={() => product && cart.setQuantity(product, item.quantity + 1)}
                        />
                        <p className="font-semibold tabular-nums">
                          {priceFormatter.format(
                            ((product ? Math.round(product.price * 100) : item.unitAmount) *
                              item.quantity) /
                              100,
                          )}
                        </p>
                      </div>
                      {productsQuery.isSuccess && (!product || item.quantity > product.stock) && (
                        <p role="alert" className="mt-2 text-sm text-destructive">
                          {product
                            ? `Solo quedan ${product.stock} unidades. Reduce la cantidad para pagar.`
                            : 'Este producto ya no está disponible. Elimínalo para continuar.'}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <aside
            className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6"
            aria-label="Resumen de compra"
          >
            <h2 className="text-lg font-semibold">Resumen de compra</h2>
            <div className="flex justify-between gap-4 text-sm">
              <span>Productos</span>
              <span className="tabular-nums">
                {order?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? cart.count} unidades
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-semibold tabular-nums">
                {priceFormatter.format(totalAmount / 100)}
              </span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Los impuestos aplicables se muestran al pagar.
            </p>
            {!session && !sessionPending ? (
              <Link to="/login" className={buttonVariants()}>
                Inicia sesión para pagar
              </Link>
            ) : pending ? (
              <div className="flex flex-col gap-3">
                {checkout ? (
                  <a href={checkout.url} className={buttonVariants()}>
                    <CreditCard data-icon="inline-start" />
                    Continuar pago
                  </a>
                ) : (
                  <p role="status" className="flex items-center gap-2 text-sm">
                    <LoaderCircle
                      className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Preparando el pago…
                  </p>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  Tus cantidades están reservadas mientras completas este pago.
                </p>
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: order.id }}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Ver pedido
                </Link>
                {checkoutQuery.error && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void checkoutQuery.refetch()}
                  >
                    Reintentar consulta del pago
                  </Button>
                )}
              </div>
            ) : (
              <Button
                type="button"
                size="lg"
                disabled={cart.checkoutKey ? mutation.isPending : !canPay}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <CreditCard data-icon="inline-start" />
                )}
                {mutation.isPending
                  ? 'Preparando pedido…'
                  : cart.checkoutKey
                    ? 'Reintentar pago'
                    : 'Pagar'}
              </Button>
            )}
            {(mutation.error || cart.failureReason) && (
              <p role="alert" className="text-sm leading-6 text-destructive">
                {mutation.error?.message ?? cart.failureReason}
              </p>
            )}
            {productsQuery.error && (
              <>
                <p role="alert" className="text-sm text-destructive">
                  No se pudo actualizar el catálogo.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void productsQuery.refetch()}
                >
                  Reintentar catálogo
                </Button>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
