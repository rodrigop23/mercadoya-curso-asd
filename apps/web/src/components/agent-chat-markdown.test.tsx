// @vitest-environment jsdom
import { act, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AgentChat } from './agent-chat';

const stream = vi.hoisted(() => ({
  messages: [
    { id: 'old', type: 'ai', content: '**Anterior**' },
    { id: 'human', type: 'human', content: '**x**' },
    { id: 'latest', type: 'ai', content: '**Nuevo**' },
  ],
  isLoading: true,
  isThreadLoading: false,
  interrupts: [],
}));
vi.mock('@langchain/react', () => ({ useStream: () => stream }));
vi.mock('@/features/cart/cart-context', () => ({ useCart: () => ({}) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@mercadoya/ui/components/message-scroller', () => {
  const Wrapper = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    MessageScroller: Wrapper,
    MessageScrollerProvider: Wrapper,
    MessageScrollerViewport: Wrapper,
    MessageScrollerContent: Wrapper,
    MessageScrollerItem: Wrapper,
    MessageScrollerButton: () => null,
    useMessageScroller: () => ({ scrollToEnd: vi.fn() }),
  };
});

it('mantiene al usuario literal y anima solo la última respuesta del asistente', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<AgentChat userId="markdown-test" />));
    const trigger = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    await act(() => trigger.click());
    await act(async () => {
      await import('@mercadoya/ui/components/markdown-renderer');
    });
    await vi.waitFor(() =>
      expect(container.querySelectorAll('.assistant-markdown')).toHaveLength(2),
    );
    const human = container.querySelector(
      '[data-slot="message"][data-align="end"] [data-slot="bubble-content"]',
    )!;
    expect(human.textContent).toBe('**x**');
    expect(human.querySelector('strong')).toBeNull();
    expect(human.classList.contains('whitespace-pre-wrap')).toBe(true);
    const assistants = container.querySelectorAll('.assistant-markdown');
    expect(assistants[0]!.outerHTML).not.toContain('streamdown-caret');
    expect(assistants[1]!.outerHTML).toContain('streamdown-caret');
    expect(assistants[1]!.querySelector('strong')?.textContent).toBe('Nuevo');
    stream.isLoading = false;
    await act(() => root.render(<AgentChat userId="markdown-test" />));
    expect(container.innerHTML).not.toContain('streamdown-caret');
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});
