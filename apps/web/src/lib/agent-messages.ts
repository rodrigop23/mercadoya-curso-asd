import { agentProposalSchema, type AgentProposal } from './agent-actions';

/** Responses API mezcla texto con reasoning y otros bloques no visibles. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        block !== null &&
        typeof block === 'object' &&
        block.type === 'text' &&
        typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

export type TranscriptRow =
  | { kind: 'message'; id: string; type: 'human' | 'ai'; text: string }
  | { kind: 'status'; id: string; text: string }
  | {
      kind: 'confirmation';
      id: string;
      proposal: AgentProposal | null;
      raw: unknown;
      state: 'pending' | 'sending' | 'error';
    };

export function transcriptRows(
  messages: readonly {
    id?: string;
    type: string;
    content: unknown;
    tool_calls?: { id?: string; name: string }[];
    tool_call_id?: string;
  }[],
  {
    toolLabel,
    isLoading,
    isThreadLoading,
    interrupts = [],
    confirmationStates = {},
  }: {
    toolLabel: string | null;
    isLoading: boolean;
    isThreadLoading: boolean;
    interrupts?: readonly { id?: string; value?: unknown }[];
    confirmationStates?: Record<string, 'pending' | 'sending' | 'error'>;
  },
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const positions = { human: 0, ai: 0 };
  for (const message of messages) {
    if (message.type !== 'human' && message.type !== 'ai') continue;
    // Contar antes de descartar vacíos: el id no cambia al llegar texto o completar una tool.
    const position = positions[message.type]++;
    const text = messageText(message.content);
    if (!text) continue;
    rows.push({
      kind: 'message',
      id: message.id ?? `agent-message:${message.type}:${position}`,
      type: message.type,
      text,
    });
  }
  let lastAiIndex = messages.length - 1;
  while (lastAiIndex >= 0 && messages[lastAiIndex]?.type !== 'ai') lastAiIndex -= 1;
  const latestCalls = messages[lastAiIndex]?.tool_calls ?? [];
  const activeProposal =
    latestCalls.length === 1 &&
    ['propose_add_to_cart', 'propose_cancel_order'].includes(latestCalls[0]!.name) &&
    !messages
      .slice(lastAiIndex + 1)
      .some((message) => message.type === 'tool' && message.tool_call_id === latestCalls[0]!.id);
  // El SDK puede reproducir interrupts históricos al recibir eventos del siguiente turno.
  // El último interrupt raíz pertenece a la única propuesta activa; el resto ya se respondió.
  const current =
    !isLoading && !isThreadLoading && (messages.length === 0 || activeProposal)
      ? interrupts.at(-1)
      : undefined;
  if (current?.id) {
    const parsed = agentProposalSchema.safeParse(current.value);
    rows.push({
      kind: 'confirmation',
      id: current.id,
      proposal: parsed.success ? parsed.data : null,
      raw: current.value,
      state: confirmationStates[current.id] ?? 'pending',
    });
  }
  const status = isThreadLoading
    ? 'Cargando conversación…'
    : isLoading
      ? (toolLabel ?? 'Recibiendo respuesta…')
      : null;
  if (status) rows.push({ kind: 'status', id: 'agent-status', text: status });
  return rows;
}

/** Solo nombres y estados; nunca muestra argumentos ni contenido de ToolMessage. */
export function pendingToolLabel(
  messages: readonly {
    type: string;
    tool_calls?: { id?: string; name: string }[];
    tool_call_id?: string;
  }[],
): string | null {
  let aiIndex = messages.length - 1;
  while (aiIndex >= 0 && messages[aiIndex]?.type !== 'ai') aiIndex -= 1;
  if (aiIndex < 0) return null;
  const completed = new Set(
    messages
      .slice(aiIndex + 1)
      .filter((message) => message.type === 'tool')
      .map((message) => message.tool_call_id),
  );
  const pending =
    messages[aiIndex]?.tool_calls?.filter((call) => !call.id || !completed.has(call.id)) ?? [];
  if (pending.some((call) => ['list_my_orders', 'get_my_order'].includes(call.name))) {
    return 'Consultando tus pedidos…';
  }
  if (
    pending.some((call) => ['search_products', 'get_product', 'check_stock'].includes(call.name))
  ) {
    return 'Consultando catálogo…';
  }
  return null;
}
