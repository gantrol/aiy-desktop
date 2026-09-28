import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { ContentSearchInput } from '@/renderer/features/content-search/ContentSearchInput';
import { ContentSearchResults } from '@/renderer/features/content-search/ContentSearchResults';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { insertOutlineContentLink, outlineLinkItem } from '@/renderer/features/content-editor/outlineContentLink';
import { activeOutlineView, focusOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import {
  outlineLinkedCreateInputSchema,
  type ContentLinkResult,
  type OutlineLinkedCreateInput,
} from '@/shared/contracts/content-links';
import { referenceFailure } from '@/shared/i18n/reference-outline';

function readPendingLink(storageKey: string, host: ReturnType<typeof useOutlineContentLinkHost>, blockId: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { pending: null, error: false };
    const pending = outlineLinkedCreateInputSchema.parse(JSON.parse(raw));
    if (
      pending.spaceId !== host?.spaceId ||
      pending.sourceArticleId !== host?.articleId ||
      pending.sourceBlockId !== blockId
    )
      return { pending: null, error: true };
    return { pending, error: false };
  } catch {
    return { pending: null, error: true };
  }
}

interface OutlineContentLinkDialogProps {
  editor: Editor;
  blockId: string;
  mode: 'EXISTING' | 'NEW';
  onClose(): void;
}

function useOutlineContentLinkDialog({ editor, blockId, mode, onClose }: OutlineContentLinkDialogProps) {
  const host = useOutlineContentLinkHost();
  const referenceHost = useContentReferenceHost();
  const copy = useI18n().messages.referenceOutline;
  const returnView = useRef(activeOutlineView(editor));
  const storageKey = `aiy:outline-linked-create:${JSON.stringify([host?.spaceId, host?.articleId, blockId])}`;
  const [initial, setInitial] = useState(() => readPendingLink(storageKey, host, blockId));
  const [pending, setPending] = useState<OutlineLinkedCreateInput | null>(initial.pending);
  const [title, setTitle] = useState(
    initial.pending?.title ?? outlineLinkItem(editor, blockId)?.node.firstChild?.textContent.slice(0, 200) ?? '',
  );
  const [format, setFormat] = useState<'MANUSCRIPT' | 'OUTLINE'>(initial.pending?.format ?? 'MANUSCRIPT');
  const [albumId, setAlbumId] = useState(initial.pending ? initial.pending.albumId : (host?.albumId ?? null));
  const [category, setCategory] = useState<'ARTICLE' | 'ALBUM'>('ARTICLE');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [target, setTarget] = useState<ContentLinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error ? copy.linkRecoveryFailed : '');
  const running = useRef(false);
  const epoch = useRef(0);
  const cancelPending = useCallback(() => {
    epoch.current++;
  }, []);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelPending();
    };
  }, [cancelPending]);
  const creating = mode === 'NEW' || Boolean(pending);
  const close = () => {
    cancelPending();
    onClose();
  };
  const abandon = () => {
    try {
      localStorage.removeItem(storageKey);
      cancelPending();
      setPending(null);
      setInitial({ pending: null, error: false });
      setError('');
      // This only abandons recovery; the created work and any live document edits are retained.
      onClose();
    } catch {
      setError(copy.linkRecoveryFailed);
    }
  };

  const commit = async (selected?: { kind: 'ARTICLE' | 'ALBUM'; id: string }) => {
    if (
      !host ||
      running.current ||
      initial.error ||
      editor.isDestroyed ||
      !editor.isEditable ||
      activeOutlineView(editor).composing
    )
      return;
    running.current = true;
    const request = ++epoch.current;
    const current = () => mounted.current && request === epoch.current && !editor.isDestroyed;
    setBusy(true);
    setError('');
    try {
      if (!outlineLinkItem(editor, blockId)) throw new Error('REFERENCE_LOCATION_MISSING');
      let result = target;
      if (!result && selected)
        result = await contentLibraryApi().linkResolve({
          spaceId: host.spaceId,
          target: selected,
        });
      if (!result && creating) {
        let input = pending;
        if (!input) {
          const saved = await referenceHost.beforeCapture?.();
          if (!current()) return;
          if (!saved?.revisionId || saved.id !== host.articleId) throw new Error('REFERENCE_SAVE_FAILED');
          input = outlineLinkedCreateInputSchema.parse({
            spaceId: host.spaceId,
            requestId: crypto.randomUUID(),
            sourceArticleId: host.articleId,
            sourceBlockId: blockId,
            expectedRevisionId: saved.revisionId,
            title,
            format,
            albumId,
          });
          // Write the recovery key before creating anything. A lost reply can retry this exact operation.
          localStorage.setItem(storageKey, JSON.stringify(input));
          setPending(input);
        }
        result = await contentLibraryApi().outlineLinkedCreate(input);
      }
      if (!current() || !result) return;
      setTarget(result);
      if (!insertOutlineContentLink(editor, blockId, result.url, result.title))
        throw new Error('REFERENCE_LOCATION_MISSING');
      const saved = await referenceHost.beforeCapture?.();
      if (!current()) return;
      if (!saved) throw new Error('REFERENCE_SAVE_FAILED');
      localStorage.removeItem(storageKey);
      setPending(null);
      onClose();
    } catch (reason) {
      if (!current()) return;
      if (String(reason).includes('OUTLINE_LINK_SOURCE_CHANGED')) {
        // This explicit failure is returned before creation. A later attempt may capture the new source revision.
        localStorage.removeItem(storageKey);
        setPending(null);
        setError(copy.changed);
      } else setError(referenceFailure(reason, copy, copy.linkFailed));
    } finally {
      running.current = false;
      if (current()) setBusy(false);
    }
  };
  return {
    host,
    copy,
    returnView,
    initial,
    pending,
    title,
    setTitle,
    format,
    setFormat,
    albumId,
    setAlbumId,
    category,
    setCategory,
    query,
    setQuery,
    composing,
    setComposing,
    target,
    busy,
    error,
    setError,
    creating,
    commit,
    close,
    abandon,
  };
}

export function OutlineContentLinkDialog(props: OutlineContentLinkDialogProps) {
  const { editor } = props;
  const {
    host,
    copy,
    returnView,
    initial,
    pending,
    title,
    setTitle,
    format,
    setFormat,
    albumId,
    setAlbumId,
    category,
    setCategory,
    query,
    setQuery,
    composing,
    setComposing,
    target,
    busy,
    error,
    setError,
    creating,
    commit,
    close,
    abandon,
  } = useOutlineContentLinkDialog(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="flex max-h-[80vh] max-w-lg flex-col"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editor.isDestroyed) focusOutlineView(editor, returnView.current);
        }}
      >
        <DialogTitle>{creating ? copy.linkCreate : copy.linkExisting}</DialogTitle>
        {creating ? (
          <>
            <OutlineLinkedCreateFields
              title={title}
              format={format}
              albumId={albumId}
              currentAlbumId={host?.albumId ?? null}
              disabled={busy || Boolean(pending)}
              onTitle={setTitle}
              onFormat={setFormat}
              onAlbum={setAlbumId}
            />
            {pending && !target && (
              <p role="status" className="text-xs text-muted-foreground">
                {copy.linkResume}
              </p>
            )}
          </>
        ) : (
          !target && (
            <>
              <Select
                value={category}
                disabled={busy}
                onValueChange={(value) => {
                  setCategory(value as typeof category);
                  setQuery('');
                }}
              >
                <SelectTrigger aria-label={copy.choose}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARTICLE">{copy.linkDocuments}</SelectItem>
                  <SelectItem value="ALBUM">{copy.albums}</SelectItem>
                </SelectContent>
              </Select>
              <ContentSearchInput
                aria-label={copy.searchSources}
                placeholder={copy.searchSources}
                query={query}
                onQuery={setQuery}
                onComposing={setComposing}
              />
              <div className="flex min-h-40 flex-1 flex-col overflow-hidden">
                {category === 'ARTICLE' ? (
                  <ContentSearchResults
                    type="ARTICLE"
                    query={query}
                    enabled={!busy && !composing}
                    onSelect={(item) => void commit({ kind: 'ARTICLE', id: item.source.id })}
                  />
                ) : (
                  <OutlineAlbumLinkResults
                    query={query}
                    disabled={busy || composing}
                    onSelect={(id) => void commit({ kind: 'ALBUM', id })}
                  />
                )}
              </div>
            </>
          )
        )}
        {target && (
          <div className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{target.title || target.target.id}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!openAppContentLink(target.url)) setError(copy.navigationUnsupported);
              }}
            >
              <ExternalLink className="size-3.5" />
              {copy.linkOpen}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {(pending || initial.error || target) && (
          <Button variant="ghost" size="sm" title={copy.linkAbandonHint} onClick={abandon}>
            {copy.linkAbandon}
          </Button>
        )}
        {(creating || target) && (
          <Button
            disabled={busy || initial.error || (!target && !pending && !title.trim())}
            onClick={() => void commit()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {target ? copy.linkRepair : pending ? copy.retry : copy.linkCreate}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutlineLinkedCreateFields({
  title,
  format,
  albumId,
  currentAlbumId,
  disabled,
  onTitle,
  onFormat,
  onAlbum,
}: {
  title: string;
  format: 'MANUSCRIPT' | 'OUTLINE';
  albumId: string | null;
  currentAlbumId: string | null;
  disabled: boolean;
  onTitle(value: string): void;
  onFormat(value: 'MANUSCRIPT' | 'OUTLINE'): void;
  onAlbum(value: string | null): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  return (
    <>
      <Input
        aria-label={copy.linkTitle}
        value={title}
        maxLength={200}
        disabled={disabled}
        onChange={(event) => onTitle(event.target.value)}
      />
      <Select value={format} disabled={disabled} onValueChange={(value) => onFormat(value as typeof format)}>
        <SelectTrigger aria-label={copy.linkFormat}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="MANUSCRIPT">{copy.linkManuscript}</SelectItem>
          <SelectItem value="OUTLINE">{copy.outline}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={albumId ? 'CURRENT' : 'ROOT'}
        disabled={disabled}
        onValueChange={(value) => onAlbum(value === 'CURRENT' ? currentAlbumId : null)}
      >
        <SelectTrigger aria-label={copy.linkDestination}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {currentAlbumId && <SelectItem value="CURRENT">{copy.linkCurrentAlbum}</SelectItem>}
          <SelectItem value="ROOT">{copy.linkRoot}</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

export function OutlineAlbumLinkResults({
  query,
  disabled,
  onSelect,
}: {
  query: string;
  disabled: boolean;
  onSelect(id: string): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  const [items, setItems] = useState<{ id: string; title: string }[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const cancelPending = useCallback(() => {
    generation.current++;
  }, []);
  const load = async (offset: number) => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await contentLibraryApi().referenceSearch('ALBUM', query, offset);
      if (request !== generation.current) return;
      setItems((previous) => [
        ...new Map(
          [
            ...(offset ? previous : []),
            ...result.items.map((item) => ({
              id: item.target.source.id,
              title: item.title,
            })),
          ].map((item) => [item.id, item]),
        ).values(),
      ]);
      setNextOffset(result.nextOffset);
    } catch (reason) {
      if (request === generation.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    generation.current++;
    setItems([]);
    setNextOffset(null);
    if (disabled) return;
    const timer = setTimeout(() => void load(0), 180);
    return () => {
      clearTimeout(timer);
      cancelPending();
    };
    // The query and composition state own each page request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, disabled, cancelPending]);
  return (
    <div className="min-h-0 overflow-y-auto" aria-busy={busy}>
      {items.map((item) => (
        <Button
          key={item.id}
          data-search-result={item.id}
          variant="ghost"
          className="h-auto w-full justify-start text-left"
          disabled={disabled || busy}
          onClick={() => onSelect(item.id)}
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{item.title || item.id}</span>
            <span className="truncate text-xs text-muted-foreground">{item.id}</span>
          </span>
        </Button>
      ))}
      {!busy && !error && !items.length && (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {nextOffset === null ? copy.linkNoTargets : copy.linkNoPageTargets}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {(error || nextOffset !== null) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || busy}
          onClick={() => void load(error ? 0 : nextOffset!)}
        >
          {error ? copy.retry : copy.more}
        </Button>
      )}
    </div>
  );
}
