import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
} from '@mercadoya/ui/components/message-scroller';
import { Separator } from '@mercadoya/ui/components/separator';
import { Spinner } from '@mercadoya/ui/components/spinner';
import { Textarea } from '@mercadoya/ui/components/textarea';
import { pendingToolLabel, transcriptRows } from '@/lib/agent-messages';
import { savedThreadFetch } from '@/lib/agent-thread';
import { API_BASE_URL } from '@/lib/products';

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
  });
  const hasMessages = rows.some((row) => row.kind === 'message');
  const status = rows.find((row) => row.kind === 'status');

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
        <Button variant="ghost" size="sm" disabled={busy} onClick={onNewThread}>
          <PlusIcon data-icon="inline-start" />
          Nuevo hilo
        </Button>
      </div>
      {open && (
        <MessageScrollerProvider
          // La fila de carga no debe consumir la posición inicial del historial guardado.
          key={stream.isThreadLoading ? 'loading' : 'transcript'}
          autoScroll
          defaultScrollPosition="last-anchor"
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
                          Puedo consultar productos, precios, stock y tus pedidos. Todavía no puedo
                          modificar tu carrito o tus pedidos.
                        </p>
                      </MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                )}
                {rows.map((row) => (
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
        </MessageScrollerProvider>
      )}
      <div
        role="status"
        aria-live="polite"
        className="shrink-0 px-4 pb-2 text-xs text-muted-foreground"
      >
        {busy && <span className="sr-only">{status?.text}</span>}
        {!busy && hasMessages && !error && 'Respuesta recibida.'}
      </div>
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
      <form
        className="flex shrink-0 flex-col gap-3 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim() || busy) return;
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
        <Button type="submit" disabled={busy || !draft.trim()} className="self-end">
          <SendIcon data-icon="inline-start" />
          Enviar
        </Button>
      </form>
    </section>
  );
}
