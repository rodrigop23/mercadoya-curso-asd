import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ListFilter, Radio } from 'lucide-react';

import { buttonVariants, Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EventTimeline } from '@/components/event-timeline';
import { eventsQueryOptions } from '@/lib/events';

export const Route = createFileRoute('/events')({ component: EventsPage });

function EventsPage() {
  const [draftOrderId, setDraftOrderId] = useState('');
  const [orderId, setOrderId] = useState<string | undefined>();
  const eventsQuery = useQuery(eventsQueryOptions({ limit: 100, orderId, refetchInterval: 1500 }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Eventos recientes</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sigue cómo Orders, Inventory y Notifications procesan cada pedido.
          </p>
        </div>
        <Link to="/catalog" className={buttonVariants({ variant: 'outline' })}>
          Ir al catálogo <ArrowRight data-icon="inline-end" />
        </Link>
      </div>

      <Card className="mt-7 shadow-sm">
        <CardHeader className="border-b border-border/70 px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-primary">
              <Radio className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold">Event timeline</h2>
              <CardDescription className="mt-1">
                Más recientes primero · últimos 100 eventos en memoria
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 px-5 py-5 sm:px-6">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setOrderId(draftOrderId.trim() || undefined);
            }}
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="event-order-filter" className="text-xs text-muted-foreground">
                Filtrar por orderId
              </Label>
              <Input
                id="event-order-filter"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="UUID del pedido"
                value={draftOrderId}
                onChange={(event) => setDraftOrderId(event.currentTarget.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline">
                <ListFilter data-icon="inline-start" />
                Filtrar
              </Button>
              {orderId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraftOrderId('');
                    setOrderId(undefined);
                  }}
                >
                  Limpiar
                </Button>
              )}
            </div>
          </form>

          {orderId && (
            <p className="break-all font-mono text-xs text-muted-foreground">
              Mostrando eventos de {orderId}
            </p>
          )}

          <EventTimeline
            events={eventsQuery.data ?? []}
            isLoading={eventsQuery.isPending || eventsQuery.isFetching}
            error={eventsQuery.error}
            emptyTitle={orderId ? 'No hay eventos para ese pedido' : 'Todavía no hay eventos'}
            emptyMessage={
              orderId
                ? 'Comprueba que el UUID sea correcto. El API conserva hasta 100 eventos desde que inició.'
                : 'Crea un pedido desde el catálogo para ver los publish y consume del bus.'
            }
            showOrderLinks
          />
        </CardContent>
      </Card>
    </main>
  );
}
