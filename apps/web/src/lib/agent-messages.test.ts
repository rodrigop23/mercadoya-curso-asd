import { describe, expect, it } from 'vitest';
import { messageText, pendingToolLabel } from './agent-messages';

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
