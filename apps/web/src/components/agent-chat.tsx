import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AgentConfirmationCard } from './agent-confirmation-card';
import { useCart } from '@/features/cart/cart-context';
import {
  isPendingAgentInterrupt,
  unknownActionRejection,
  type ActionResume,
} from '@/lib/agent-actions';
import type { TranscriptRow } from '@/lib/agent-messages';
import { useStream } from '@langchain/react';
import { BotIcon, MessageCircleIcon, PlusIcon, SendIcon, XIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@mercadoya/ui/components/alert';
import { Avatar, AvatarFallback } from '@mercadoya/ui/components/avatar';
import { Bubble, BubbleContent } from '@mercadoya/ui/components/bubble';
import { Button } from '@mercadoya/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@mercadoya/ui/components/field';
import { Marker, MarkerContent, MarkerIcon } from '@mercadoya/ui/components/marker';
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from '@mercadoya/ui/components/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@mercadoya/ui/components/message-scroller';
import { Separator } from '@mercadoya/ui/components/separator';
import { Spinner } from '@mercadoya/ui/components/spinner';
import { Textarea } from '@mercadoya/ui/components/textarea';
import { pendingToolLabel, transcriptRows } from '@/lib/agent-messages';
import { savedThreadFetch } from '@/lib/agent-thread';
import { API_BASE_URL, type Product } from '@/lib/products';

const credentialFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'include' });

function storedThread(userId: string): string | null {
  try {
    return sessionStorage.getItem(`mercadoya:agent:${userId}`);
  } catch {
    return null;
  }
}

export function AgentChat({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState(() => storedThread(userId));
  const [generation, setGeneration] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const rememberThread = useCallback(
    (id: string | null) => {
      setThreadId(id);
      try {
        if (id) sessionStorage.setItem(`mercadoya:agent:${userId}`, id);
        else sessionStorage.removeItem(`mercadoya:agent:${userId}`);
      } catch {
        // El chat funciona también cuando el navegador bloquea sessionStorage.
      }
    },
    [userId],
  );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const newThread = useCallback(() => {
    rememberThread(null);
    setGeneration((current) => current + 1);
  }, [rememberThread]);

  return (
    <div className="fixed right-3 bottom-3 z-30 sm:right-6 sm:bottom-6">
      <ChatPanel
        key={generation}
        open={open}
        panelId={panelId}
        threadId={threadId}
        onThreadId={rememberThread}
        onClose={close}
        onNewThread={newThread}
      />
      <Button
        ref={trigger}
        size="lg"
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MessageCircleIcon data-icon="inline-start" />
        Asistente
      </Button>
    </div>
  );
}

function ChatPanel({
  open,
  panelId,
  threadId,
  onThreadId,
  onClose,
  onNewThread,
}: {
  open: boolean;
  panelId: string;
  threadId: string | null;
  onThreadId: (id: string) => void;
  onClose: () => void;
  onNewThread: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmationStates, setConfirmationStates] = useState<
    Record<string, 'pending' | 'sending' | 'error'>
  >({});
  const responding = useRef(new Set<string>());
  const cart = useCart();
  const queryClient = useQueryClient();
  const input = useRef<HTMLTextAreaElement>(null);
  const [savedThreadId] = useState(threadId);
  const apiUrl = `${API_BASE_URL.replace(/\/$/, '')}/api/agent`;
  const callerOptions = useMemo(
    () => ({ fetch: savedThreadFetch(apiUrl, savedThreadId, onNewThread) }),
    [apiUrl, savedThreadId, onNewThread],
  );
  const stream = useStream({
    assistantId: 'agent',
    apiUrl,
    callerOptions,
    threadId,
    onThreadId,
    transport: 'sse',
    fetch: credentialFetch,
  });
  const toolLabel = pendingToolLabel(stream.messages);
  const busy = stream.isLoading || stream.isThreadLoading;
  const error = localError || !!stream.error;
  const rows = transcriptRows(stream.messages, {
    toolLabel,
    isLoading: stream.isLoading,
    isThreadLoading: stream.isThreadLoading,
    interrupts: stream.interrupts,
    confirmationStates,
  });
  const confirmation = rows.find((row) => row.kind === 'confirmation');
  const transcript = rows.filter((row) => row.kind !== 'confirmation');
  const hasConfirmation = !!confirmation;
  const hasMessages = rows.some((row) => row.kind === 'message');
  const status = rows.find((row) => row.kind === 'status');

  const respond = async (
    row: Extract<TranscriptRow, { kind: 'confirmation' }>,
    approved: boolean,
  ) => {
    if (responding.current.has(row.id) || stream.isLoading || stream.isThreadLoading) return;
    if (!stream.interrupts.some((entry) => entry.id === row.id)) {
      setConfirmationError('Esta confirmación ya fue respondida');
      return;
    }
    responding.current.add(row.id);
    setConfirmationStates((current) => ({ ...current, [row.id]: 'sending' }));
    setConfirmationError(null);
    const proposal = row.proposal;
    const resume: ActionResume = proposal
      ? { action_id: proposal.action_id, approved }
      : unknownActionRejection(row.raw);
    try {
      const perform = async () => {
        const response = await credentialFetch(`${apiUrl}/threads/${stream.threadId}`);
        if (!response.ok) throw { status: response.status };
        if (!isPendingAgentInterrupt(await response.json(), row.id, proposal?.action_id)) {
          throw { status: 409 };
        }
        if (approved && proposal?.kind === 'add_to_cart') {
          let product: Product | null = null;
          let failure: ActionResume['result'];
          try {
            const response = await fetch(
              `${API_BASE_URL}/api/products/${encodeURIComponent(proposal.product_id)}`,
            );
            if (response.status === 404) failure = { applied: false, reason: 'not_found' };
            else if (!response.ok) failure = { applied: false, reason: 'invalid' };
            else product = ((await response.json()) as { product: Product }).product;
          } catch {
            failure = { applied: false, reason: 'invalid' };
          }
          resume.result = cart.applyAgentProposal(proposal, product, failure ?? undefined);
        }
        await stream.respond(resume, { interruptId: row.id });
        if (proposal?.kind === 'cancel_order') {
          await queryClient.invalidateQueries({ queryKey: ['orders'] });
        }
      };
      // Serializar pestañas del mismo origen antes de comprobar, aplicar y reanudar.
      if (navigator.locks) await navigator.locks.request(`mercadoya:agent:${row.id}`, perform);
      else await perform();
    } catch (error) {
      setConfirmationStates((current) => ({ ...current, [row.id]: 'error' }));
      // El texto remoto nunca se muestra: podría contener argumentos o credenciales.
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      setConfirmationError(
        status === 409 || status === 400
          ? 'Esta confirmación ya fue respondida'
          : 'No se pudo enviar la confirmación. Recarga el chat para consultar su estado.',
      );
    }
  };

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <section
      id={panelId}
      hidden={!open}
      aria-labelledby={`${panelId}-title`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute right-0 bottom-14 flex h-[min(36rem,calc(100dvh-6rem))] w-[min(25rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h2 id={`${panelId}-title`} className="font-semibold">
            Asistente de MercadoYa
          </h2>
          <p className="text-sm text-muted-foreground">Conversemos sobre tus compras.</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Cerrar chat" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <Separator />
      <div className="flex shrink-0 justify-end px-4 py-2">
        <Button variant="ghost" size="sm" disabled={busy || hasConfirmation} onClick={onNewThread}>
          <PlusIcon data-icon="inline-start" />
          Nuevo hilo
        </Button>
      </div>
      {open && (
        <MessageScrollerProvider
          // La fila de carga no debe consumir la posición inicial del historial guardado.
          key={stream.isThreadLoading ? 'loading' : 'transcript'}
          autoScroll
          defaultScrollPosition="end"
        >
          <MessageScroller className="flex-1">
            <MessageScrollerViewport
              aria-label="Mensajes del asistente"
              suppressHydrationWarning
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <MessageScrollerContent aria-busy={busy} className="gap-4 px-4 pb-4">
                {!hasMessages && !stream.isThreadLoading && (
                  <MessageScrollerItem messageId="agent-empty" className="my-auto py-6">
                    <Marker variant="default">
                      <MarkerContent className="flex flex-col gap-2">
                        <p>¿Qué tienes en mente para tu próxima compra?</p>
                        <p>
                          Puedo consultar productos y tus pedidos, y proponer agregar al carrito o
                          cancelar un pedido pendiente. Tú apruebas cada cambio.
                        </p>
                      </MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                )}
                {transcript.map((row) => (
                  <MessageScrollerItem
                    key={row.id}
                    messageId={row.id}
                    scrollAnchor={row.kind === 'message' && row.type === 'human'}
                  >
                    {row.kind === 'message' ? (
                      <Message align={row.type === 'human' ? 'end' : 'start'}>
                        <MessageAvatar aria-hidden="true">
                          <Avatar>
                            <AvatarFallback>
                              {row.type === 'human' ? 'Tú' : <BotIcon />}
                            </AvatarFallback>
                          </Avatar>
                        </MessageAvatar>
                        <MessageContent>
                          <MessageHeader>{row.type === 'human' ? 'Tú' : 'Asistente'}</MessageHeader>
                          <Bubble
                            variant={row.type === 'human' ? 'default' : 'muted'}
                            align={row.type === 'human' ? 'end' : 'start'}
                          >
                            <BubbleContent className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                              {row.text}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    ) : (
                      <Marker variant="default">
                        <MarkerIcon>
                          <Spinner />
                        </MarkerIcon>
                        <MarkerContent>{row.text}</MarkerContent>
                      </Marker>
                    )}
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton behavior="auto" aria-label="Ir al último mensaje" />
          </MessageScroller>
          <ScrollToConfirmation interruptId={confirmation?.id} />
        </MessageScrollerProvider>
      )}
      <div
        role="status"
        aria-live="polite"
        className="shrink-0 px-4 pb-2 text-xs text-muted-foreground"
      >
        {busy && <span className="sr-only">{status?.text}</span>}
        {!busy && hasConfirmation && 'Confirma o rechaza la acción propuesta.'}
        {!busy && !hasConfirmation && hasMessages && !error && 'Respuesta recibida.'}
      </div>
      {confirmationError && (
        <Alert variant="destructive" className="mx-4 mb-3 w-auto shrink-0">
          <AlertTitle>{confirmationError}</AlertTitle>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mx-4 mb-3 w-auto shrink-0">
          <AlertTitle>No se pudo completar la conversación</AlertTitle>
          <AlertDescription>
            Reintenta enviando tu mensaje. Si el problema continúa, revisa tu sesión o prueba más
            tarde.
          </AlertDescription>
        </Alert>
      )}
      <Separator />
      {confirmation ? (
        <div className="min-h-0 shrink-0 p-4">
          {open && (
            <AgentConfirmationCard
              key={confirmation.id}
              proposal={confirmation.proposal}
              state={confirmation.state}
              onRespond={(approved) => void respond(confirmation, approved)}
            />
          )}
        </div>
      ) : (
        <form
          className="flex shrink-0 flex-col gap-3 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!draft.trim() || busy || hasConfirmation) return;
            const content = draft.trim();
            setLocalError(false);
            setDraft('');
            try {
              await stream.submit({ messages: [{ type: 'human', content }] });
            } catch {
              setDraft(content);
              setLocalError(true);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${panelId}-message`}>Tu mensaje</FieldLabel>
              <Textarea
                ref={input}
                id={`${panelId}-message`}
                disabled={hasConfirmation || busy}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                className="max-h-28 resize-none"
                placeholder="Escribe aquí…"
              />
            </Field>
          </FieldGroup>
          <Button
            type="submit"
            disabled={busy || hasConfirmation || !draft.trim()}
            className="self-end"
          >
            <SendIcon data-icon="inline-start" />
            Enviar
          </Button>
        </form>
      )}
    </section>
  );
}

/** La confirmación ocupa el pie del panel; el scroller conserva el control del historial. */
function ScrollToConfirmation({ interruptId }: { interruptId?: string }) {
  const { scrollToEnd } = useMessageScroller();
  useLayoutEffect(() => {
    if (interruptId) scrollToEnd({ behavior: 'auto' });
  }, [interruptId, scrollToEnd]);
  return null;
}
