import { Fragment } from 'react';
import { contentSearchHighlights } from '@/shared/content-search-highlights';

export function ContentSearchHighlight({ text, terms }: { text: string; terms: readonly string[] }) {
  const matches = contentSearchHighlights(text, terms);
  let offset = 0;
  return (
    <>
      {matches.map(({ start, end }) => {
        const before = text.slice(offset, start);
        offset = end;
        return (
          <Fragment key={start}>
            {before}
            <mark className="rounded-sm bg-warning-surface px-0 text-foreground">{text.slice(start, end)}</mark>
          </Fragment>
        );
      })}
      {text.slice(offset)}
    </>
  );
}
