// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import MarkdownRenderer from '@mercadoya/ui/components/markdown-renderer';
import { AssistantMarkdown } from '@mercadoya/ui/components/markdown';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});
async function render(text: string, streaming = false) {
  await act(() => root.render(<MarkdownRenderer streaming={streaming}>{text}</MarkdownRenderer>));
}

it('convierte listas, tablas GFM, código y negrita en elementos semánticos', async () => {
  await render(
    '- **Sonix Air**\n- Sonix Pro\n\n| Producto | Precio |\n| --- | --- |\n| Air | S/ 129 |\n\n```js\nconst x = 1;\n```',
  );
  expect(container.querySelectorAll('ul li')).toHaveLength(2);
  expect(container.querySelector('strong')?.textContent).toBe('Sonix Air');
  expect(container.querySelectorAll('table th')).toHaveLength(2);
  expect(container.querySelectorAll('table td')).toHaveLength(2);
  expect(container.querySelector('pre code')?.textContent).toContain('const x = 1;');
  expect(
    container.querySelector('[data-streamdown="table-wrapper"] button')?.getAttribute('title'),
  ).toBe('Copiar tabla');
  expect(
    container.querySelector('[data-streamdown="code-block"] button')?.getAttribute('title'),
  ).toBe('Copiar código');
  expect(container.querySelector('[title*="Download"], [title*="Descargar"]')).toBeNull();
});

it.each([
  ['**hola', 'strong', 'hola'],
  ['| Producto | Precio |\n| --- | --- |\n| Sonix', 'table', 'Sonix'],
  ['```js\nconst x = 1;', 'pre code', 'const x = 1;'],
])('completa Markdown durante el stream: %s', async (text, selector, content) => {
  await render(text, true);
  expect(container.querySelector(selector)?.textContent).toContain(content);
  expect(container.textContent).not.toMatch(/\*\*|\||```/);
});

it.each([
  '[x](javascript:alert(1))',
  '[x](data:text/html,<script>alert(1)</script>)',
  '[x](mailto:ana@example.com)',
  '[x](//example.com/path)',
  '[x](/path)',
  '<a href="javascript:alert(1)">x</a>',
])('no convierte una URL prohibida en enlace: %s', async (text) => {
  await render(text);
  expect(container.querySelector('a[href]')).toBeNull();
});

it('omite HTML crudo e imágenes, conservando el texto alternativo de Markdown', async () => {
  await render(
    '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<iframe src="https://example.com"></iframe>\n\n![audífonos](https://example.com/image.png)',
  );
  expect(container.querySelector('script, img, iframe')).toBeNull();
  expect(container.textContent).toContain('audífonos');
});

it('abre enlaces http(s) con aislamiento y conserva el renderer de Streamdown', async () => {
  await render('[Catálogo](https://example.com/catalog)');
  const link = container.querySelector('a')!;
  expect(link.href).toBe('https://example.com/catalog');
  expect(link.target).toBe('_blank');
  expect(link.rel.split(' ')).toEqual(
    expect.arrayContaining(['noopener', 'noreferrer', 'nofollow']),
  );
  expect(link.dataset.streamdown).toBe('link');
});

it('un enlace incompleto permanece como texto sin placeholder clicable', async () => {
  await render('[Catálogo](https://example.com/cat', true);
  expect(container.textContent).toContain('Catálogo');
  expect(container.querySelector('a')).toBeNull();
});

it('espera el separador de una tabla antes de mostrar su cabecera durante el stream', async () => {
  await render('Compara:\n\n| Producto | Precio |\n| --', true);
  expect(container.textContent).toBe('Compara:');
  await render('Compara:\n\n| Producto | Precio |\n| --- | --- |\n| Air | S/ 129 |', true);
  expect(container.querySelector('table')).not.toBeNull();
  expect(container.textContent).not.toContain('|');
});

it('activa el caret solo mientras llega el stream y lo retira al terminar', async () => {
  await render('Hola', true);
  expect(container.innerHTML).toContain('streamdown-caret');
  await render('Hola', false);
  expect(container.innerHTML).not.toContain('streamdown-caret');
});

it('Suspense muestra el texto plano mientras carga el módulo diferido', () => {
  const html = renderToString(<AssistantMarkdown>{'**hola**\n- lista'}</AssistantMarkdown>);
  expect(html).toContain('whitespace-pre-wrap');
  expect(html).toContain('**hola**\n- lista');
  expect(html).not.toContain('<strong>');
});
