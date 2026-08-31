import { Fragment, memo, useMemo } from 'react';
import { codexThreadTextSegments } from '@/renderer/lib/codexThreadLinks';

export const CodexThreadLinkText = memo(function CodexThreadLinkText({ value }: { value: string }) {
  const segments = useMemo(() => codexThreadTextSegments(value), [value]);
  return segments.map((segment) =>
    segment.kind === 'THREAD' ? (
      <span
        key={segment.offset}
        data-codex-thread-id={segment.threadId}
        className="text-selected-foreground underline decoration-selected-border underline-offset-4"
      >
        {segment.value}
      </span>
    ) : (
      <Fragment key={segment.offset}>{segment.value}</Fragment>
    ),
  );
});
