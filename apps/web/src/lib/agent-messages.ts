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
