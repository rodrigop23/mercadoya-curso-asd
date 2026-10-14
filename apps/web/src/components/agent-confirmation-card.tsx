import { useEffect, useId, useRef } from 'react';
import { Badge } from '@mercadoya/ui/components/badge';
import { Button } from '@mercadoya/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@mercadoya/ui/components/card';
import { Spinner } from '@mercadoya/ui/components/spinner';
import type { AgentProposal } from '@/lib/agent-actions';

export function AgentConfirmationCard({
  proposal,
  state,
  onRespond,
}: {
  proposal: AgentProposal | null;
  state: 'pending' | 'sending' | 'error';
  onRespond: (approved: boolean) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const clicked = useRef(false);
  const titleId = useId();
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, []);
  const cancel = proposal?.kind === 'cancel_order';
  const createdAt = proposal?.kind === 'cancel_order' ? new Date(proposal.created_at) : null;
  const createdLabel =
    createdAt && !Number.isNaN(createdAt.getTime())
      ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(
          createdAt,
        )
      : 'Fecha no disponible';
  const disabled = state !== 'pending';
  const respond = (approved: boolean) => {
    if (clicked.current || disabled) return;
    clicked.current = true;
    onRespond(approved);
  };
  return (
    <Card
      ref={card}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-busy={state === 'sending'}
      className="max-h-[min(20rem,40dvh)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="shrink-0">
        <CardTitle id={titleId}>
          {!proposal
            ? 'Acción no reconocida'
            : cancel
              ? '¿Cancelar este pedido?'
              : '¿Agregar al carrito?'}
        </CardTitle>
        <CardDescription>
          {!proposal
            ? 'No pude validar esta acción. Puedes rechazarla y volver a pedirla.'
            : cancel
              ? 'Se cancelará solo si el pedido sigue pendiente y el pago no está en proceso.'
              : 'Comprobaremos el precio y el stock actuales al aprobar.'}
        </CardDescription>
      </CardHeader>
      {proposal && (
        <CardContent className="flex min-h-0 flex-col gap-2 overflow-y-auto [overflow-wrap:anywhere]">
          {proposal.kind === 'add_to_cart' ? (
            <>
              <p className="font-medium">{proposal.title}</p>
              <p className="tabular-nums">
                {proposal.quantity} {proposal.quantity === 1 ? 'unidad' : 'unidades'} · S/{' '}
                {proposal.unit_price_pen} por unidad
              </p>
              <p className="text-muted-foreground">Stock consultado: {proposal.stock}</p>
            </>
          ) : (
            <>
              <p className="font-medium">Pedido #{proposal.order_id.slice(0, 8)}</p>
              <Badge variant="secondary">Pendiente</Badge>
              <p className="tabular-nums">
                {proposal.items_count} {proposal.items_count === 1 ? 'unidad' : 'unidades'} ·{' '}
                {proposal.total_pen === null ? 'Importe no disponible' : `S/ ${proposal.total_pen}`}
              </p>
              <p className="text-muted-foreground">Creado: {createdLabel}</p>
            </>
          )}
        </CardContent>
      )}
      {state === 'error' && (
        <CardContent role="alert">
          No se pudo enviar la confirmación. Recarga el chat para consultar su estado.
        </CardContent>
      )}
      <CardFooter className="shrink-0 flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => respond(false)}>
          Rechazar
        </Button>
        {proposal && (
          <Button
            variant={cancel ? 'destructive' : 'default'}
            disabled={disabled}
            onClick={() => respond(true)}
          >
            {state === 'sending' && <Spinner data-icon="inline-start" />}
            {state === 'sending' ? 'Enviando…' : 'Aprobar'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
