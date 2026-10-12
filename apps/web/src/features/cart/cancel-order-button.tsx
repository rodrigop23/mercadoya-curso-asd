import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { Button } from '@mercadoya/ui/components/button';
import { Spinner } from '@mercadoya/ui/components/spinner';
import { Alert, AlertDescription } from '@mercadoya/ui/components/alert';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@mercadoya/ui/components/alert-dialog';
import { cancelOrder, OrderRequestError, orderQueryOptions } from '@/lib/orders';

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => cancelOrder(orderId),
    onSuccess(order) {
      queryClient.setQueryData(orderQueryOptions(order.id).queryKey, order);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'list'] });
      setOpen(false);
    },
    onError() {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: orderQueryOptions(orderId).queryKey });
    },
  });
  const notice = mutation.error instanceof OrderRequestError && mutation.error.status === 409;
  return (
    <div className="flex flex-col gap-3">
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
      >
        <AlertDialogTrigger render={<Button variant="outline" disabled={mutation.isPending} />}>
          Cancelar pedido
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejaremos de esperar el pago y devolveremos las unidades al stock. Tus productos
              seguirán en el carrito para que puedas volver a comprar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              Seguir con el pedido
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              {mutation.isPending ? 'Cancelando…' : 'Sí, cancelar pedido'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {mutation.error && (
        <Alert variant={notice ? 'default' : 'destructive'} role={notice ? 'status' : 'alert'}>
          <CircleAlert />
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
