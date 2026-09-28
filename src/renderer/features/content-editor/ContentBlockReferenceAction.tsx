import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Quote } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { copyContentReference } from '@/renderer/features/content-editor/contentReferenceClipboard';
import type { ContentReference } from '@/shared/contracts/content-library';
import { ContentBlockUsesAction } from '@/renderer/features/content-editor/ContentBlockUsesAction';
import { currentReferenceTarget } from '@/renderer/features/content-editor/ContentReferencePicker';
import { followingPresentation } from '@/shared/content-reference-token';

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
  const capture = async (scope: 'SELF' | 'SUBTREE', following = false) => {
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
      const target = following ? currentReferenceTarget(source, blockId, false, scope) : { source, blockId, scope };
      const preview = await api.referenceInspect(target);
      if (!active.current || editor.isDestroyed) return;
      const key = JSON.stringify([preview.target, preview.version, following]);
      const reference =
        captured.current?.key === key
          ? captured.current.reference
          : following
            ? await api.referenceFollow(preview.target, preview.version)
            : await api.referenceCapture(preview.target, preview.version, preview.resolutionId);
      captured.current = { key, reference };
      if (!active.current || editor.isDestroyed) return;
      stage = 'clipboard';
      await copyContentReference(
        reference,
        'REFERENCE',
        following ? { presentation: followingPresentation, editing: 'SOURCE' } : undefined,
      );
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
      {host.outline ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Quote className="size-4 shrink-0" />
            {copy.copyReference}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                disabled={busy}
                onSelect={(event) => {
                  event.preventDefault();
                  void capture('SELF');
                }}
              >
                {copy.self}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy}
                onSelect={(event) => {
                  event.preventDefault();
                  void capture('SUBTREE');
                }}
              >
                {copy.subtree}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      ) : (
        <DropdownMenuItem
          disabled={busy}
          onSelect={(event) => {
            event.preventDefault();
            void capture('SELF');
          }}
        >
          <Quote />
          {copy.copyReference}
        </DropdownMenuItem>
      )}
      {host.source.kind === 'ARTICLE' && (
        <DropdownMenuItem
          disabled={busy}
          onSelect={(event) => {
            event.preventDefault();
            void capture('SELF', true);
          }}
        >
          {copy.copyFollowing}
        </DropdownMenuItem>
      )}
      {status && (
        <span role="status" className="block max-w-64 px-2 py-1 text-xs">
          {status}
        </span>
      )}
      <ContentBlockUsesAction blockId={blockId} />
    </>
  );
}
