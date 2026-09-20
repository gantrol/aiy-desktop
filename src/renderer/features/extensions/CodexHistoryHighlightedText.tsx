import { Fragment } from 'react';
import { codexHistoryHighlights } from '@/shared/codex-history-search-query';

export const historyHighlightClassName =
  'box-decoration-clone rounded-sm bg-[color-mix(in_srgb,var(--warning)_30%,var(--warning-surface))] font-semibold text-foreground underline decoration-warning/80 decoration-2 underline-offset-2';

export function CodexHistoryHighlightedText({ text, query }: { text: string; query: string }) {
  const matches = codexHistoryHighlights(text, query);
  if (!matches.length) return text;
  return (
    <>
      {matches.map((match, index) => (
        <Fragment key={match.start}>
          {text.slice(index ? matches[index - 1]!.end : 0, match.start)}
          <mark className={historyHighlightClassName}>{text.slice(match.start, match.end)}</mark>
        </Fragment>
      ))}
      {text.slice(matches.at(-1)!.end)}
    </>
  );
}
