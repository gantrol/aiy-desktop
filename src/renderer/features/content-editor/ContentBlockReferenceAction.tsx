import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Quote } from 'lucide-react';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { copyContentReference } from '@/renderer/features/content-editor/contentReferenceClipboard';
import type { ContentReference } from '@/shared/contracts/content-library';
import { ContentBlockUsesAction } from '@/renderer/features/content-editor/ContentBlockUsesAction';

export function ContentBlockReferenceAction({ editor, blockId }: { editor: Editor; blockId: string }) {
  const host = useContentReferenceHost();
  const copy = useI18n().messages.referenceOutline;
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const running = useRef(false);
  const captured = useRef<{ key: string; reference: ContentReference } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (!host.source) return null;
  const capture = async (scope: 'SELF' | 'SUBTREE') => {
    if (running.current || editor.isDestroyed || editor.view.composing) return;
    running.current = true;
    setBusy(true);
    setStatus('');
    let stage: 'save' | 'capture' | 'clipboard' = 'save';
    try {
      const source = host.beforeCapture ? await host.beforeCapture() : host.source;
      if (!active.current || editor.isDestroyed) return;
      if (!source) throw new Error('REFERENCE_SAVE_FAILED');
      stage = 'capture';
      const api = contentLibraryApi();
      const preview = await api.referenceInspect({ source, blockId, scope });
      if (!active.current || editor.isDestroyed) return;
      const key = JSON.stringify([preview.target, preview.version]);
      const reference =
        captured.current?.key === key
          ? captured.current.reference
          : await api.referenceCapture(preview.target, preview.version);
      captured.current = { key, reference };
      if (!active.current || editor.isDestroyed) return;
      stage = 'clipboard';
      await copyContentReference(reference);
      if (active.current) setStatus(copy.copied);
    } catch (reason) {
      console.error('[content-reference] copy failed', stage, reason);
      if (active.current)
        setStatus(
          referenceFailure(
            reason,
            copy,
            {
              save: copy.saveFailed,
              capture: copy.captureFailed,
              clipboard: copy.clipboardFailed,
            }[stage],
          ),
        );
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <>
      <DropdownMenuItem
        disabled={busy}
        onSelect={(event) => {
          event.preventDefault();
          void capture('SELF');
        }}
      >
        <Quote />
        {host.outline ? `${copy.copyReference} · ${copy.self}` : copy.copyReference}
      </DropdownMenuItem>
      {host.outline && (
        <DropdownMenuItem
          disabled={busy}
          onSelect={(event) => {
            event.preventDefault();
            void capture('SUBTREE');
          }}
        >
          <Quote />
          {copy.copyReference} · {copy.subtree}
        </DropdownMenuItem>
      )}
      <ContentBlockUsesAction blockId={blockId} />
      {status && (
        <span role="status" className="block max-w-64 px-2 py-1 text-xs">
          {status}
        </span>
      )}
    </>
  );
}
