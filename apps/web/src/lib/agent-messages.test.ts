import { describe, expect, it } from 'vitest';
import { messageText, pendingToolLabel, transcriptRows } from './agent-messages';

describe('messageText', () => {
  it('conserva strings y saltos de línea', () => {
    expect(messageText('uno\ndos')).toBe('uno\ndos');
  });

  it('concatena solo texto, sin añadir separadores a los chunks', () => {
    expect(
      messageText([
        { type: 'reasoning', text: 'privado' },
        { type: 'text', text: 'Ho' },
        { type: 'text', text: 'la\n' },
        { type: 'image', url: 'image.png' },
        { type: 'text', text: 'MercadoYa' },
      ]),
    ).toBe('Hola\nMercadoYa');
  });

  it('ignora contenido inválido', () => {
    for (const content of [null, undefined, 1, {}, [null, 'hola', {}, { type: 'text' }]]) {
      expect(messageText(content)).toBe('');
    }
  });
});

describe('transcriptRows', () => {
  const idle = { toolLabel: null, isLoading: false, isThreadLoading: false };

  it('incluye solo human/ai con texto y conserva los ids del mensaje', () => {
    expect(
      transcriptRows(
        [
          { id: 'system', type: 'system', content: 'instrucciones privadas' },
          { id: 'human', type: 'human', content: 'Hola\nMercadoYa' },
          { id: 'empty', type: 'ai', content: '' },
          { id: 'tool', type: 'tool', content: 'resultado privado' },
          { id: 'ai', type: 'ai', content: 'Hola' },
        ],
        idle,
      ),
    ).toEqual([
      { kind: 'message', id: 'human', type: 'human', text: 'Hola\nMercadoYa' },
      { kind: 'message', id: 'ai', type: 'ai', text: 'Hola' },
    ]);
  });

  it('ignora reasoning y otros bloques, incluso en mensajes sin texto visible', () => {
    expect(
      transcriptRows(
        [
          { type: 'ai', content: [{ type: 'reasoning', text: 'privado' }] },
          { type: 'ai', content: null },
          {
            id: 'response',
            type: 'ai',
            content: [
              { type: 'reasoning', text: 'privado' },
              { type: 'text', text: 'Ho' },
              { type: 'image', url: 'image.png' },
              { type: 'text', text: 'la' },
            ],
          },
        ],
        idle,
      ),
    ).toEqual([{ kind: 'message', id: 'response', type: 'ai', text: 'Hola' }]);
  });

  it('muestra la tool pendiente al final y la retira al completar o parar el stream', () => {
    const messages = [
      { id: 'human', type: 'human', content: 'Busca café' },
      {
        type: 'ai',
        content: '',
        tool_calls: [{ id: 'call', name: 'search_products', args: { query: 'café' } }],
      },
    ];
    expect(
      transcriptRows(messages, {
        ...idle,
        isLoading: true,
        toolLabel: pendingToolLabel(messages),
      }).at(-1),
    ).toEqual({ kind: 'status', id: 'agent-status', text: 'Consultando catálogo…' });

    const completed = [
      ...messages,
      { type: 'tool', tool_call_id: 'call', content: 'resultado privado' },
    ];
    expect(
      transcriptRows(completed, {
        ...idle,
        isLoading: true,
        toolLabel: pendingToolLabel(completed),
      }).at(-1),
    ).toEqual({ kind: 'status', id: 'agent-status', text: 'Recibiendo respuesta…' });
    expect(transcriptRows(messages, { ...idle, toolLabel: pendingToolLabel(messages) })).toEqual([
      { kind: 'message', id: 'human', type: 'human', text: 'Busca café' },
    ]);
    const last = transcriptRows(messages, {
      ...idle,
      isLoading: true,
      toolLabel: 'Consultando tus pedidos…',
    }).at(-1);
    expect(last?.kind === 'status' ? last.text : null).toBe('Consultando tus pedidos…');
  });

  it('prioriza la carga del hilo y no deja filas de estado cuando queda inactivo', () => {
    expect(
      transcriptRows([], {
        toolLabel: 'Consultando catálogo…',
        isLoading: true,
        isThreadLoading: true,
      }),
    ).toEqual([{ kind: 'status', id: 'agent-status', text: 'Cargando conversación…' }]);
    expect(transcriptRows([], idle)).toEqual([]);
  });

  it('mantiene ids deterministas al filtrar vacíos y tools y al crecer el texto', () => {
    const messages = [
      { type: 'ai', content: '' },
      { type: 'human', content: 'Hola' },
      { type: 'ai', content: 'Ho' },
      { type: 'human', content: 'Hola' },
    ];
    const before = transcriptRows(messages, idle);
    const after = transcriptRows(
      [
        { type: 'system', content: 'privado' },
        { type: 'ai', content: 'Ahora hay texto' },
        messages[1]!,
        { type: 'tool', content: 'privado' },
        { type: 'ai', content: 'Hola\nMercadoYa' },
        messages[3]!,
      ],
      idle,
    );
    expect(after.slice(1).map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(new Set(after.map((row) => row.id)).size).toBe(after.length);
    expect(transcriptRows(messages, idle)).toEqual(before);
    expect(
      transcriptRows([...messages, { type: 'ai', content: 'Nueva respuesta' }], idle).slice(0, 3),
    ).toEqual(before);
  });
});

describe('pendingToolLabel', () => {
  it('indica catálogo sin exponer argumentos', () => {
    expect(
      pendingToolLabel([{ type: 'ai', tool_calls: [{ id: 'c', name: 'search_products' }] }]),
    ).toBe('Consultando catálogo…');
    for (const name of ['get_product', 'check_stock']) {
      expect(pendingToolLabel([{ type: 'ai', tool_calls: [{ name }] }])).toBe(
        'Consultando catálogo…',
      );
    }
  });
  it('indica pedidos mientras queda una llamada pendiente', () => {
    expect(
      pendingToolLabel([
        {
          type: 'ai',
          tool_calls: [
            { id: 'a', name: 'get_my_order' },
            { id: 'b', name: 'list_my_orders' },
          ],
        },
        { type: 'tool', tool_call_id: 'a' },
      ]),
    ).toBe('Consultando tus pedidos…');
  });
  it('se apaga al completar, incluso con error o una nueva respuesta', () => {
    const ai = { type: 'ai', tool_calls: [{ id: 'a', name: 'list_my_orders' }] };
    expect(pendingToolLabel([ai, { type: 'tool', tool_call_id: 'a' }])).toBeNull();
    expect(pendingToolLabel([ai, { type: 'ai' }])).toBeNull();
    expect(pendingToolLabel([ai, { type: 'tool', tool_call_id: 'other' }])).toBe(
      'Consultando tus pedidos…',
    );
  });
  it('ignora historiales sin tools y herramientas desconocidas', () => {
    for (const messages of [
      [],
      [{ type: 'human' }],
      [{ type: 'ai' }],
      [{ type: 'ai', tool_calls: [{ name: 'unknown' }] }],
    ]) {
      expect(pendingToolLabel(messages)).toBeNull();
    }
  });
});

describe('filas de confirmación', () => {
  const idle = { toolLabel: null, isLoading: false, isThreadLoading: false };
  const proposal = {
    kind: 'add_to_cart',
    action_id: '12345678-1234-5678-9234-567812345678',
    product_id: '00000000-0000-4000-8000-000000000001',
    title: 'Café',
    unit_price_pen: '12.90',
    quantity: 2,
    stock: 7,
  };
  it('rehidrata interrupciones válidas y conserva su id para respond', () => {
    const row = transcriptRows([], {
      ...idle,
      interrupts: [{ id: 'interrupt-1', value: proposal }],
    })[0];
    expect(row).toEqual({
      kind: 'confirmation',
      id: 'interrupt-1',
      proposal,
      raw: proposal,
      state: 'pending',
    });
    expect(transcriptRows([], { ...idle, interrupts: [] })).toEqual([]);
  });
  it('incluye sending/error y muestra payload inválido como no reconocido', () => {
    for (const state of ['sending', 'error'] as const) {
      expect(
        transcriptRows([], {
          ...idle,
          interrupts: [{ id: 'i', value: proposal }],
          confirmationStates: { i: state },
        })[0],
      ).toMatchObject({ kind: 'confirmation', state });
    }
    expect(
      transcriptRows([], { ...idle, interrupts: [{ id: 'bad', value: { kind: 'unknown' } }] })[0],
    ).toMatchObject({ kind: 'confirmation', proposal: null });
  });
});

it('muestra solo el interrupt actual al reproducir eventos históricos del SDK', () => {
  const proposal = {
    kind: 'cancel_order',
    action_id: '12345678-1234-5678-9234-567812345678',
    order_id: '00000000-0000-4000-8000-000000000001',
    status: 'pending',
    total_pen: '12.90',
    items_count: 1,
    created_at: '2026-10-12T10:00:00Z',
  };
  const ai = {
    type: 'ai',
    content: '',
    tool_calls: [{ id: 'new-call', name: 'propose_cancel_order' }],
  };
  const interrupts = [
    { id: 'old', value: proposal },
    { id: 'current', value: proposal },
  ];
  const options = { toolLabel: null, isLoading: false, isThreadLoading: false, interrupts };
  expect(
    transcriptRows([ai], options)
      .filter((row) => row.kind === 'confirmation')
      .map((row) => row.id),
  ).toEqual(['current']);
  expect(
    transcriptRows([ai, { type: 'tool', tool_call_id: 'new-call', content: 'Rechazado' }], options),
  ).toEqual([]);
  expect(
    transcriptRows([ai, { type: 'ai', content: 'No se hizo ningún cambio' }], options).some(
      (row) => row.kind === 'confirmation',
    ),
  ).toBe(false);
  expect(
    transcriptRows([ai], { ...options, isLoading: true }).some(
      (row) => row.kind === 'confirmation',
    ),
  ).toBe(false);
});
