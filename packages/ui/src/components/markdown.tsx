import * as React from 'react';
import { cn } from '@mercadoya/ui/lib/utils';

import type { AssistantMarkdownProps } from './markdown-renderer';
export type { AssistantMarkdownProps } from './markdown-renderer';

const MarkdownRenderer = React.lazy(() => import('./markdown-renderer'));

export function AssistantMarkdown(props: AssistantMarkdownProps) {
  return (
    <React.Suspense
      fallback={
        <div className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', props.className)}>
          {props.children}
        </div>
      }
    >
      <MarkdownRenderer {...props} />
    </React.Suspense>
  );
}
