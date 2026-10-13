import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AgentChatEmptyState } from './agent-chat-empty-state';

it('explica la memoria y el derecho a olvidarla en el estado vacío', () => {
  const html = renderToStaticMarkup(createElement(AgentChatEmptyState));
  expect(html).toContain(
    'Puedo recordar preferencias como tu talla o presupuesto; pídeme que las olvide cuando quieras',
  );
});
