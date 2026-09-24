import { Link } from '@tanstack/react-router';
import { ArrowUpRight, CircleAlert, Radio, ShoppingBasket, Waypoints } from 'lucide-react';

import type { TimelineEvent } from '@/lib/events';

type EventTimelineProps = {
  events: TimelineEvent[];
  isLoading?: boolean;
  error?: Error | null;
  emptyTitle: string;
  emptyMessage: string;
  showOrderLinks?: boolean;
};

const eventTypeLabels: Record<string, string> = {
  'event.publish': 'Publicado',
  'event.consume': 'Consumido',
  'event.handler_error': 'Error del consumidor',
  'event.transport': 'Transporte activo',
  'event.transport_fallback': 'Cambio de transporte',
  'orders.status_updated': 'Estado actualizado',
  'orders.status_ignored': 'Actualización omitida',
  'inventory.reservation': 'Reserva de inventario',
  'notification.stub': 'Notificación simulada',
};

const eventTones: Record<string, string> = {
  publish: 'bg-emerald-500 ring-emerald-100',
  consume: 'bg-sky-500 ring-sky-100',
  error: 'bg-red-500 ring-red-100',
  inventory: 'bg-amber-500 ring-amber-100',
  notification: 'bg-violet-500 ring-violet-100',
  default: 'bg-slate-400 ring-slate-100',
};

const statusTones: Record<string, string> = {
  confirmed: 'bg-emerald-50 text-emerald-800',
  reserved: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-red-50 text-red-800',
  pending: 'bg-amber-50 text-amber-800',
};

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  rejected: 'Rechazado',
  reserved: 'Reservado',
};

const rejectionReasons: Record<string, string> = {
  invalid_quantity: 'cantidad no válida',
  product_not_found: 'producto no encontrado',
  insufficient_stock: 'stock insuficiente',
  stock_limit: 'límite de stock',
};

const timestampFormatter = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
});

function getTone(event: TimelineEvent) {
  if (event.type.includes('error')) return eventTones.error;
  if (event.type === 'event.publish') return eventTones.publish;
  if (event.type === 'event.consume') return eventTones.consume;
  if (event.type.startsWith('inventory.')) return eventTones.inventory;
  if (event.type.startsWith('notification.')) return eventTones.notification;
  return eventTones.default;
}

function getEventLabel(event: TimelineEvent) {
  return eventTypeLabels[event.type] ?? event.type;
}

function getEventStatus(event: TimelineEvent) {
  if (typeof event.status === 'string') return event.status;
  if (typeof event.outcome === 'string') return event.outcome;
  return null;
}

function getStatusLabel(status: string) {
  return statusLabels[status] ?? status;
}

function getStatusTone(status: string) {
  return statusTones[status] ?? 'bg-slate-100 text-slate-700';
}

function getReasonLabel(reason: string) {
  return rejectionReasons[reason] ?? reason;
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : timestampFormatter.format(date);
}

export function EventTimeline({
  events,
  isLoading = false,
  error,
  emptyTitle,
  emptyMessage,
  showOrderLinks = false,
}: EventTimelineProps) {
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <p className="text-sm font-medium text-red-900">No se pudo cargar la timeline</p>
        <p className="mt-1 text-sm leading-5 text-red-800">{error.message}</p>
      </div>
    );
  }

  if (isLoading && events.length === 0) {
    return (
      <div className="space-y-5 py-2" aria-label="Cargando eventos" aria-busy="true">
        {[0, 1, 2].map((item) => (
          <div key={item} className="flex animate-pulse gap-4 motion-reduce:animate-none">
            <span className="mt-1 size-3 shrink-0 rounded-full bg-emerald-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-28 rounded bg-muted" />
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-center">
        <Waypoints className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <h3 className="mt-3 text-sm font-semibold">{emptyTitle}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <ol className="relative ml-1 border-l border-emerald-200/80">
      {events.map((event) => {
        const status = getEventStatus(event);

        return (
          <li key={event.id} className="relative pb-6 pl-6 last:pb-0 sm:pl-8">
            <span
              className={`absolute -left-[6px] top-1.5 size-3 rounded-full ring-4 ${getTone(event)}`}
              aria-hidden="true"
            />
            <article className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    {event.type === 'event.publish' ? (
                      <Radio className="size-3.5 text-emerald-700" aria-hidden="true" />
                    ) : event.type === 'event.consume' ? (
                      <Waypoints className="size-3.5 text-sky-700" aria-hidden="true" />
                    ) : event.type === 'event.handler_error' ? (
                      <CircleAlert className="size-3.5 text-red-700" aria-hidden="true" />
                    ) : event.type === 'orders.status_updated' ? (
                      <ShoppingBasket className="size-3.5 text-emerald-700" aria-hidden="true" />
                    ) : null}
                    {getEventLabel(event)}
                  </span>
                  {event.subject && (
                    <code className="max-w-full break-all rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                      {event.subject}
                    </code>
                  )}
                  {status && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${getStatusTone(status)}`}
                    >
                      {getStatusLabel(status)}
                    </span>
                  )}
                </div>
                <time
                  dateTime={event.timestamp}
                  className="text-[11px] tabular-nums text-muted-foreground"
                >
                  {formatTimestamp(event.timestamp)}
                </time>
              </div>

              {(event.consumer || event.transport || event.reason || event.notificationSubject) && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-muted-foreground">
                  {event.consumer && (
                    <span>
                      consumidor{' '}
                      <code className="font-mono text-foreground/80">{event.consumer}</code>
                    </span>
                  )}
                  {event.transport && (
                    <span>
                      transporte{' '}
                      <code className="font-mono text-foreground/80">{event.transport}</code>
                    </span>
                  )}
                  {event.reason && <span>motivo: {getReasonLabel(event.reason)}</span>}
                  {event.notificationSubject && <span>{event.notificationSubject}</span>}
                </div>
              )}

              {showOrderLinks && event.orderId && (
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: event.orderId }}
                  className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  <span className="truncate">Pedido {event.orderId}</span>
                  <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
                </Link>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
