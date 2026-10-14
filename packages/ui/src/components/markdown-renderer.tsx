import type { ComponentProps } from 'react';
import {
  Streamdown,
  defaultComponents,
  defaultRehypePlugins,
  type ExtraProps,
  type StreamdownProps,
} from 'streamdown';
import { cn } from '@mercadoya/ui/lib/utils';
export interface AssistantMarkdownProps {
  children: string;
  streaming?: boolean;
  className?: string;
}

type MarkdownNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
  value?: string;
};

// Un img es un nodo vacío: unwrapDisallowed por sí solo pierde su alt en 2.7.0.
function imageAltText() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      node.children = node.children?.map((child) => {
        if (child.type === 'element' && child.tagName === 'img') {
          return { type: 'text', value: String(child.properties?.alt ?? '') };
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

type RehypePlugin = Extract<
  NonNullable<StreamdownProps['rehypePlugins']>[number],
  (...args: never[]) => unknown
>;
const harden = (
  Array.isArray(defaultRehypePlugins.harden)
    ? defaultRehypePlugins.harden[0]
    : defaultRehypePlugins.harden
) as RehypePlugin;

const rehypePlugins: StreamdownProps['rehypePlugins'] = [
  imageAltText,
  defaultRehypePlugins.sanitize!,
  [
    harden,
    {
      allowedProtocols: ['http', 'https'],
      allowedLinkPrefixes: ['*'],
      linkBlockPolicy: 'text-only',
      allowedImagePrefixes: [],
      allowDataImages: false,
    },
  ],
];

// También excluye URLs relativas y protocol-relative, sin resolverlas contra el host.
function httpUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

const DefaultLink = defaultComponents.a;
function AssistantLink(props: ComponentProps<'a'> & ExtraProps) {
  const href = httpUrl(props.href ?? '');
  if (!href) return <span>{props.children}</span>;
  return <DefaultLink {...props} href={href} target="_blank" rel="noopener noreferrer nofollow" />;
}

// Referencias estables para que Streamdown pueda memoizar los bloques terminados.
const DefaultStrong = defaultComponents.strong;
function AssistantStrong(props: ComponentProps<'strong'> & ExtraProps) {
  return (
    <strong>
      <DefaultStrong {...props} />
    </strong>
  );
}
const components = { a: AssistantLink, strong: AssistantStrong };
const disallowedElements = ['img'];
const remend = { linkMode: 'text-only' } as const;
const linkSafety = { enabled: false };
const controls = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  image: false,
  mermaid: false,
};
const translations = {
  copyCode: 'Copiar código',
  copyTable: 'Copiar tabla',
  copyTableAsMarkdown: 'Copiar como Markdown',
  copyTableAsCsv: 'Copiar como CSV',
  copyTableAsTsv: 'Copiar como TSV',
  tableFormatMarkdown: 'Markdown',
  tableFormatCsv: 'CSV',
  tableFormatTsv: 'TSV',
  copied: 'Copiado',
};

export default function MarkdownRenderer({
  children,
  streaming = false,
  className,
}: AssistantMarkdownProps) {
  // Una cabecera GFM aún no es una tabla hasta que llega la fila separadora.
  // Esperar ese fragmento evita mostrar pipes durante los primeros tokens.
  const visibleMarkdown = streaming
    ? children.replace(/(^|\n\n)([ \t]*\|[^\n]*(?:\n[ \t]*\|[-:| \t]*)?)$/, '$1')
    : children;
  return (
    <Streamdown
      className={cn('assistant-markdown min-w-0 text-sm [overflow-wrap:anywhere]', className)}
      mode="streaming"
      parseIncompleteMarkdown
      isAnimating={streaming}
      caret={streaming ? 'block' : undefined}
      skipHtml
      rehypePlugins={rehypePlugins}
      disallowedElements={disallowedElements}
      unwrapDisallowed
      urlTransform={httpUrl}
      components={components}
      remend={remend}
      linkSafety={linkSafety}
      controls={controls}
      translations={translations}
      tableMaxHeight={240}
      codeBlockMaxHeight={240}
    >
      {visibleMarkdown}
    </Streamdown>
  );
}
