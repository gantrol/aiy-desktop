import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';
import type { referenceUsesSchema } from '@/shared/contracts/content-library';
import { referenceTargetSchema, type ReferenceTarget } from '@/shared/contracts/content-source';
import { referenceFailure } from '@/shared/i18n/reference-outline';

/** Shared by a source block's menu and a captured reference's source dialog. */
export function ContentReferenceUses({
  target,
  originBlockId,
  onNavigated,
}: {
  target: ReferenceTarget;
  originBlockId?: string;
  onNavigated(): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  const navigate = useReferenceNavigation(originBlockId);
  const [uses, setUses] = useState<z.infer<typeof referenceUsesSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const cancelPending = useCallback(() => {
    epoch.current++;
  }, []);
  const targetKey = JSON.stringify(target);
  const load = useCallback(
    async (offset: number) => {
      const request = ++epoch.current;
      setBusy(true);
      setError('');
      try {
        const result = await contentLibraryApi().referenceUses(
          referenceTargetSchema.parse(JSON.parse(targetKey)),
          offset,
        );
        if (request === epoch.current)
          setUses((previous) => ({
            ...result,
            items: offset ? [...(previous?.items ?? []), ...result.items] : result.items,
          }));
      } catch (reason) {
        if (request === epoch.current) setError(referenceFailure(reason, copy));
      } finally {
        if (request === epoch.current) setBusy(false);
      }
    },
    [copy, targetKey],
  );
  useEffect(() => {
    setUses(null);
    void load(0);
    return cancelPending;
  }, [load, cancelPending]);
  const follow = async (use: z.infer<typeof referenceUsesSchema>['items'][number]) => {
    const request = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      await navigate(
        { source: use.source, ...(use.blockId ? { blockId: use.blockId } : {}) },
        { referenceId: use.referenceId },
      );
      if (request === epoch.current) onNavigated();
    } catch (reason) {
      if (request === epoch.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  };
  return (
    <section aria-label={copy.uses} aria-busy={busy}>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {uses?.items.map((use, index) => (
        <Button
          key={`${use.source.id}:${use.blockId ?? use.referenceId}:${index}`}
          variant="ghost"
          size="sm"
          disabled={busy}
          className="my-1 h-auto w-full justify-start whitespace-normal text-left text-xs"
          aria-label={`${copy.useLocation} · ${use.title || use.source.id}`}
          onClick={() => void follow(use)}
        >
          {use.title || use.source.id} · {use.blockId || copy.range}
        </Button>
      ))}
      {uses && !uses.items.length && (
        <p className="text-xs text-muted-foreground">{uses.nextOffset === null ? copy.noUsesFinal : copy.noUses}</p>
      )}
      {uses?.nextOffset !== null && uses && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load(uses.nextOffset!)}>
          {copy.more}
        </Button>
      )}
      {error && !uses && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load(0)}>
          {copy.retry}
        </Button>
      )}
    </section>
  );
}
