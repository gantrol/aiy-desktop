import { useEffect, useRef } from 'react';
import type { ArticleEditorSessionRuntime } from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import {
  creationReadingSchema,
  readingPositionSchema,
  type ReadingPosition,
} from '@/shared/contracts/creation-reading';

export function useReadingPositions(session: ArticleEditorSessionRuntime, onFailure: () => void) {
  const pending = useRef(new Map<string, ReadingPosition>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPositions = useStableCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current.size) return;
    const reading = session.model.getSnapshot().draft.metadata.reading;
    if (!reading) return;
    const positions = new Map(reading.positions?.map((item) => [item.sourceId, item]));
    for (const [id, position] of pending.current) {
      if (reading.sources.some((source) => source.id === id)) positions.set(id, position);
    }
    const result = creationReadingSchema.safeParse({ ...reading, positions: [...positions.values()] });
    if (!result.success) {
      onFailure();
      return;
    }
    pending.current.clear();
    session.readingChanged(result.data);
  });
  const rememberPosition = useStableCallback((position: ReadingPosition) => {
    if (!readingPositionSchema.safeParse(position).success) return;
    const reading = session.model.getSnapshot().draft.metadata.reading;
    if (!reading?.sources.some((source) => source.id === position.sourceId)) return;
    const previous =
      pending.current.get(position.sourceId) ?? reading.positions?.find((item) => item.sourceId === position.sourceId);
    if (JSON.stringify(previous) === JSON.stringify(position)) return;
    pending.current.set(position.sourceId, position);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushPositions, 600);
  });
  const positionFor = useStableCallback((sourceId: string): ReadingPosition | undefined => {
    const reading = session.model.getSnapshot().draft.metadata.reading;
    const saved = pending.current.get(sourceId) ?? reading?.positions?.find((item) => item.sourceId === sourceId);
    if (saved) return saved;
    const source = reading?.sources.find((item) => item.id === sourceId);
    if (!source) return;
    // A reader that has never scrolled still has a return position at its beginning.
    const isPdf = source.kind === 'FILE' && source.file.extension === '.pdf';
    const isEpub = source.kind === 'FILE' && source.file.extension === '.epub';
    return { sourceId, view: isPdf ? 'PAGE' : isEpub ? 'EPUB' : 'TEXT', scrollTop: 0, ...(isPdf ? { page: 1 } : {}) };
  });
  useEffect(() => () => flushPositions(), [flushPositions]);
  return { flushPositions, rememberPosition, positionFor };
}
