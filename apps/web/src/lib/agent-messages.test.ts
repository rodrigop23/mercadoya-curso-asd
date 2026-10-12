import { describe, expect, it } from 'vitest';
import { messageText } from './agent-messages';

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
