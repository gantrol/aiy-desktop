import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentReference, ReferencePreview } from '@/shared/contracts/content-library';
import { isDocumentSource } from '@/shared/contracts/content-source';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';

export function ContentReferenceScope({
  reference,
  onChange,
}: {
  reference: ContentReference;
  onChange(reference: ContentReference): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<ReferencePreview | null>(null);
  const epoch = useRef(0);
  const cancel = useCallback(() => {
    epoch.current++;
  }, []);
  const selector = reference.selector?.kind === 'BLOCK' ? reference.selector : null;
  useEffect(() => {
    const request = ++epoch.current;
    setPreview(null);
    setError('');
    if (!open || !selector || !isDocumentSource(reference.source)) return;
    setBusy(true);
    void contentLibraryApi()
      .referenceInspect({
        source: { ...reference.source, revisionId: reference.revisionId },
        blockId: selector.blockId,
        scope: 'SELF',
      })
      .then((value) => {
        if (request === epoch.current) setPreview(value);
      })
      .catch((reason) => {
        if (request === epoch.current) setError(referenceFailure(reason, copy));
      })
      .finally(() => {
        if (request === epoch.current) setBusy(false);
      });
    return cancel;
  }, [open, reference, selector, copy, cancel]);
  if (!selector) return null;
  const selected = preview?.blocks.find((block) => block.id === selector.blockId);
  const hasSubtree = selected?.kind === 'listItem' || selected?.kind === 'taskItem';
  const change = async (scope: 'SELF' | 'SUBTREE') => {
    if (busy || !preview) return;
    const request = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const value = await contentLibraryApi().referenceInspect({ ...preview.target, scope, section: false });
      if (request !== epoch.current) return;
      const next = await contentLibraryApi().referenceCapture(value.target, value.version);
      if (request !== epoch.current) return;
      onChange(next);
      setOpen(false);
    } catch (reason) {
      if (request === epoch.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        epoch.current++;
        setOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
          {selector.scope === 'SELF' ? copy.self : selector.scope === 'SUBTREE' ? copy.subtree : copy.block}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1">
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start"
          disabled={busy || !preview}
          onClick={() => void change('SELF')}
        >
          {copy.self}
        </Button>
        {hasSubtree && (
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            disabled={busy}
            onClick={() => void change('SUBTREE')}
          >
            {copy.subtree}
          </Button>
        )}
        {error && (
          <span role="alert" className="block px-2 text-xs text-destructive">
            {error}
          </span>
        )}
      </PopoverContent>
    </Popover>
  );
}
