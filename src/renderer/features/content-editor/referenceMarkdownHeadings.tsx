import { createElement } from 'react';
import type { Components } from 'react-markdown';

export function referenceMarkdownHeadings(occurrenceId: string): Components {
  return Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [
      `h${level}`,
      ({
        node,
        children,
      }: {
        node?: { position?: { start?: { offset?: number } } };
        children?: import('react').ReactNode;
      }) =>
        createElement(
          `h${level}`,
          {
            'data-reference-heading': true,
            'data-article-heading-id': `reference-${occurrenceId}-offset-${node?.position?.start?.offset ?? 0}`,
          },
          children,
        ),
    ]),
  );
}
