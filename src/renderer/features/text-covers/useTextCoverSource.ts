import { useEffect, useRef, useState } from 'react';
import { discoverTextCoverFonts, localTextCoverFonts } from '@/renderer/features/text-covers/textCoverFonts';
import { readTextCoverSource, type TextCoverSourceError } from '@/renderer/features/text-covers/textCoverSource';
import type { TextCoverSource } from '@/shared/contracts/text-cover-source';
import type { ArticleCoverRatio } from '@/shared/article-covers';

export function useTextCoverSource({
  lockedRatio,
  onBusyChange,
  onError,
}: {
  lockedRatio?: ArticleCoverRatio;
  onBusyChange(busy: boolean): void;
  onError(error: TextCoverSourceError | null): void;
}) {
  const [candidate, setCandidate] = useState<TextCoverSource | null>(null);
  const request = useRef(0);
  const reading = useRef(false);
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current += 1;
      controller.current?.abort();
      controller.current = null;
      if (reading.current) {
        reading.current = false;
        onBusyChange(false);
      }
    };
  }, [lockedRatio, onBusyChange]);

  async function open(file: File) {
    if (!active.current || reading.current) return;
    const generation = ++request.current;
    const current = new AbortController();
    controller.current = current;
    setCandidate(null);
    onError(null);
    reading.current = true;
    onBusyChange(true);
    try {
      const result = await readTextCoverSource(file, current.signal);
      if (generation !== request.current) return;
      if (!result.ok) return onError(result.error);
      if (lockedRatio && result.source.ratio !== lockedRatio) return onError('ratioMismatch');
      const explicitFont = localTextCoverFonts.some((font) => font.id === result.source.recipe.font);
      if (explicitFont) {
        const fonts = await discoverTextCoverFonts();
        if (generation !== request.current) return;
        if (!fonts.includes(result.source.recipe.font)) return onError('fontMissing');
      }
      setCandidate(result.source);
    } catch {
      if (generation === request.current && !current.signal.aborted) onError('readFailed');
    } finally {
      if (generation === request.current) {
        controller.current = null;
        reading.current = false;
        onBusyChange(false);
      }
    }
  }

  function close() {
    // Cancel the intent, not just its preview. A pending read must not reopen it.
    request.current += 1;
    controller.current?.abort();
    controller.current = null;
    setCandidate(null);
    if (reading.current) {
      reading.current = false;
      onBusyChange(false);
    }
  }

  return { candidate, close, open };
}
