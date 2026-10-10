import { ContentSearchResults } from '@/renderer/features/content-search/ContentSearchResults';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
export { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Blocks, ChevronLeft, LoaderCircle } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ContentSearchInput } from '@/renderer/features/content-search/ContentSearchInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentReference, ReferencePreview } from '@/shared/contracts/content-library';
import type { ReferenceScope, ReferenceSource, ReferenceTarget } from '@/shared/contracts/content-source';
import { isDocumentSource } from '@/shared/contracts/content-source';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { ContentReferenceSelection } from '@/renderer/features/content-editor/ContentReferenceSelection';
import { useContentMenuAction } from '@/renderer/features/content-editor/useContentMenuAction';
import { followingPresentation, type ReferencePresentation } from '@/shared/content-reference-token';
import { ContentReferencePresentationFields } from '@/renderer/features/content-editor/ContentReferencePresentationFields';
import { presentReferenceMarkdown } from '@/shared/content-reference-presentation';

export function currentReferenceTarget(
  source: ReferenceSource,
  blockId?: string,
  section?: boolean,
  scope?: ReferenceScope,
): ReferenceTarget {
  const { revisionId: _revisionId, ...current } = isDocumentSource(source)
    ? source
    : { ...source, revisionId: undefined };
  return {
    source:
      current.kind === 'SOCIAL_POST' || current.kind === 'INSPIRATION_STASH'
        ? { ...current, kind: 'ARTICLE' }
        : current,
    blockId,
    section,
    scope,
  };
}
type Category = 'CONTENT' | 'CREATION_ITEM' | 'ALBUM';
type Item = { target: ReferenceTarget; title: string; preview: string };
function ReferencePickerTrigger({ label, menuItem }: { label: string; menuItem: boolean }) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        size={menuItem ? 'sm' : 'icon-sm'}
        variant="ghost"
        className={menuItem ? 'w-full justify-start font-normal' : undefined}
        title={label}
        aria-label={label}
      >
        <Blocks className="size-3.5" />
        {menuItem && label}
      </Button>
    </PopoverTrigger>
  );
}
export type ReferenceInsertMode = 'FOLLOW' | 'SYNC' | 'FIXED' | 'COPY' | 'LINK';
interface ContentReferencePickerProps {
  source?: ReferenceSource;
  blockId?: string;
  section?: boolean;
  scope?: ReferenceScope;
  label?: string;
  menuItem?: boolean;
  following?: boolean;
  initialMode?: ReferenceInsertMode;
  lockMode?: boolean;
  onInsert(
    reference: ContentReference,
    presentation?: ReferencePresentation,
    mode?: ReferenceInsertMode,
  ): void | Promise<void>;
  allowLink?: boolean;
  allowSync?: boolean;
  allowCopy?: boolean;
  configurePresentation?: boolean;
  parentLevel?: number;
  onOpenChange?(open: boolean): void;
  prepareSource?(target: ReferenceTarget): Promise<void>;
  initialPresentation?: ReferencePresentation;
}
function useReferencePicker({
  source,
  blockId,
  section,
  scope,
  following = false,
  initialMode,
  onInsert,
  onOpenChange,
  prepareSource,
  initialPresentation,
  parentLevel,
}: ContentReferencePickerProps) {
  const copy = useI18n().messages.referenceOutline;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReferenceInsertMode>(initialMode ?? (following ? 'FOLLOW' : 'FIXED'));
  const follow = mode === 'FOLLOW' || mode === 'SYNC';
  const [presentation, setPresentation] = useState<ReferencePresentation>(
    initialPresentation ??
      (following ? followingPresentation : { display: 'QUOTE', showTitle: false, headings: 'PRESERVE' }),
  );
  const menu = useContentMenuAction();
  const [category, setCategory] = useState<Category>('CONTENT');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [preview, setPreview] = useState<ReferencePreview | null>(null);
  const canFollow = preview?.target.source.kind === 'ARTICLE';
  const followingSelection = follow && canFollow;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const searchOffset = useRef(0);
  const cancelPending = useCallback(() => {
    generation.current++;
  }, []);
  const requestedTarget = useRef<ReferenceTarget | null>(null);
  const canLink = Boolean(preview?.spaceId && ['ARTICLE', 'ALBUM'].includes(preview.target.source.kind));
  const projectionError = previewProjectionError(preview, mode, presentation, parentLevel);
  const sourceKey = source ? JSON.stringify(currentReferenceTarget(source, blockId, section, scope)) : '';
  const inspect = async (target: ReferenceTarget) => {
    target = currentReferenceTarget(target.source, target.blockId, target.section, target.scope);
    const request = ++generation.current;
    requestedTarget.current = target;
    // A failed selection must not leave the previous block available for insertion.
    setPreview(null);
    setBusy(true);
    setError('');
    try {
      await prepareSource?.(target);
      if (request !== generation.current) return;
      const result = await contentLibraryApi().referenceInspect(target);
      if (request !== generation.current) return;
      // The inspection already expands and freezes dependencies in one transaction.
      setPreview(result);
    } catch (reason) {
      if (request === generation.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const search = async (offset = 0) => {
    const request = ++generation.current;
    searchOffset.current = offset;
    setBusy(true);
    setError('');
    try {
      const result = await contentLibraryApi().referenceSearch(category, query, offset);
      if (request !== generation.current) return;
      setItems((current) => {
        const candidates = offset ? [...current, ...result.items] : result.items;
        return [...new Map(candidates.map((item) => [JSON.stringify(item.target), item])).values()];
      });
      setNextOffset(result.nextOffset);
    } catch (reason) {
      if (request === generation.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!open || composing) return;
    setBusy(true);
    setPreview(null);
    setItems([]);
    setNextOffset(null);
    setError('');
    requestedTarget.current = null;
    searchOffset.current = 0;
    const timer = setTimeout(
      () => {
        if (sourceKey) void inspect(JSON.parse(sourceKey) as ReferenceTarget);
        else if (category !== 'CONTENT') void search();
        else setBusy(false);
      },
      sourceKey ? 0 : 180,
    );
    return () => {
      clearTimeout(timer);
      cancelPending();
    };
    // Query identity owns a request; late results are generation-checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceKey, category, query, cancelPending, composing]);
  const resetSearch = () => {
    // Invalidate at the input event, before an older promise can settle or the effect runs.
    cancelPending();
    requestedTarget.current = null;
    searchOffset.current = 0;
    setPreview(null);
    setItems([]);
    setNextOffset(null);
    setError('');
    setBusy(true);
  };
  const capture = async () => {
    if (!preview || busy || error || projectionError || (follow && !canFollow) || (mode === 'LINK' && !canLink)) return;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const reference = followingSelection
        ? await contentLibraryApi().referenceFollow(preview.target, preview.version)
        : await contentLibraryApi().referenceCapture(preview.target, preview.version, preview.resolutionId);
      if (request !== generation.current) return;
      await onInsert(reference, mode === 'LINK' ? { ...presentation, display: 'LINK' } : presentation, mode);
      if (request !== generation.current) return;
      menu.run(() => {
        setOpen(false);
        onOpenChange?.(false);
      });
    } catch (reason) {
      if (request === generation.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  return {
    copy,
    open,
    setOpen,
    mode,
    setMode,
    presentation,
    setPresentation,
    menu,
    category,
    setCategory,
    query,
    setQuery,
    composing,
    setComposing,
    items,
    nextOffset,
    preview,
    setPreview,
    canFollow,
    busy,
    setBusy,
    error,
    setError,
    generation,
    searchOffset,
    requestedTarget,
    inspect,
    search,
    resetSearch,
    capture,
    canCapture:
      !busy && Boolean(preview) && !error && !projectionError && (!follow || canFollow) && (mode !== 'LINK' || canLink),
    showPresentation: mode !== 'LINK' && Boolean(preview) && preview?.selector?.kind !== 'MEMBERS',
    canLink,
  };
}
function previewProjectionError(
  preview: ReferencePreview | null,
  mode: ReferenceInsertMode,
  presentation: ReferencePresentation,
  parentLevel?: number,
) {
  if (!preview || mode === 'LINK') return false;
  try {
    presentReferenceMarkdown(preview, presentation, parentLevel);
    return false;
  } catch {
    return true;
  }
}

export function ContentReferencePicker(props: ContentReferencePickerProps) {
  const { source, label, menuItem = false, onOpenChange } = props;
  const {
    copy,
    open,
    setOpen,
    mode,
    setMode,
    presentation,
    setPresentation,
    menu,
    category,
    setCategory,
    query,
    setQuery,
    composing,
    setComposing,
    items,
    nextOffset,
    preview,
    setPreview,
    canFollow,
    busy,
    setBusy,
    error,
    setError,
    generation,
    searchOffset,
    requestedTarget,
    inspect,
    search,
    resetSearch,
    capture,
    canCapture,
    showPresentation,
    canLink,
  } = useReferencePicker(props);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        generation.current++;
        if (!value) setComposing(false);
        onOpenChange?.(value);
        setOpen(value);
      }}
    >
      <ReferencePickerTrigger label={label || copy.insert} menuItem={menuItem} />
      <PopoverContent
        className="flex max-h-[75vh] w-[min(26rem,calc(100vw-2rem))] flex-col gap-2 p-3"
        align="start"
        onCloseAutoFocus={menu.onCloseAutoFocus}
      >
        <strong className="text-sm">{label || copy.insert}</strong>
        {!source && !preview && (
          <ReferenceSearchControls
            category={category}
            setCategory={(value) => {
              if (value === category) return;
              resetSearch();
              setCategory(value);
            }}
            query={query}
            setQuery={(value) => {
              if (value === query) return;
              resetSearch();
              setQuery(value);
            }}
            onComposing={(value) => {
              if (value === composing) return;
              resetSearch();
              setComposing(value);
            }}
          />
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {(preview || error) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              const target = preview?.target ?? requestedTarget.current;
              if (target)
                void inspect(currentReferenceTarget(target.source, target.blockId, target.section, target.scope));
              else if (category !== 'CONTENT') void search(searchOffset.current);
              else setBusy(false);
            }}
          >
            {preview || requestedTarget.current ? copy.refresh : copy.retry}
          </Button>
        )}
        <div className="min-h-0 overflow-y-auto">
          {preview ? (
            <>
              {!source && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    generation.current++;
                    setPreview(null);
                    setError('');
                    requestedTarget.current = null;
                  }}
                >
                  <ChevronLeft className="size-3.5" />
                  {copy.back}
                </Button>
              )}
              {preview.selector?.kind === 'MEMBERS' &&
                preview.target.source.kind === 'CREATION_ITEM' &&
                preview.selector.members
                  .filter((member) => member.kind === 'ARTICLE')
                  .map((member) => (
                    <Button
                      key={member.membershipId}
                      variant="ghost"
                      className="w-full justify-start"
                      disabled={busy}
                      onClick={() => void inspect({ source: { kind: 'ARTICLE', id: member.id } })}
                    >
                      {member.title || copy.unnamed}
                    </Button>
                  ))}
              <ContentReferenceSelection
                preview={preview}
                busy={busy}
                onInspect={inspect}
                presentation={mode === 'LINK' ? undefined : presentation}
                parentLevel={props.parentLevel}
              />
            </>
          ) : !source && category === 'CONTENT' ? (
            <ContentSearchResults
              query={query}
              disabled={busy || composing}
              enabled={open && !busy && !composing}
              onSelect={(item) => void inspect({ source: item.source })}
            />
          ) : (
            <>
              {items.map((item) => (
                <Button
                  key={JSON.stringify(item.target)}
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal text-left"
                  disabled={busy}
                  onClick={() => void inspect(item.target)}
                >
                  {item.title}
                </Button>
              ))}
              {nextOffset !== null && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void search(nextOffset)}>
                  {copy.more}
                </Button>
              )}
            </>
          )}
        </div>
        {busy && <LoaderCircle className="size-4 animate-spin" aria-label={copy.choose} />}
        {!props.lockMode && (
          <ReferenceModePicker
            canFollow={Boolean(canFollow)}
            mode={mode}
            setMode={setMode}
            busy={busy}
            allowCopy={props.allowCopy}
            allowLink={props.allowLink}
            allowSync={props.allowSync}
            canLink={canLink}
          />
        )}
        {props.configurePresentation !== false && showPresentation && (
          <ContentReferencePresentationFields value={presentation} disabled={busy} onChange={setPresentation} />
        )}
        <Button disabled={!canCapture} onClick={() => void capture()}>
          {
            {
              FOLLOW: copy.followSource,
              SYNC: copy.syncSource,
              FIXED: copy.insert,
              COPY: copy.copyAsBody,
              LINK: copy.insertLink,
            }[mode]
          }
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ReferenceModePicker({
  canFollow,
  mode,
  setMode,
  busy,
  allowCopy,
  allowLink,
  allowSync,
  canLink,
}: {
  canFollow: boolean;
  mode: ReferenceInsertMode;
  setMode(value: ReferenceInsertMode): void;
  busy: boolean;
  allowCopy?: boolean;
  allowLink?: boolean;
  allowSync?: boolean;
  canLink: boolean;
}) {
  const copy = useI18n().messages.referenceOutline;
  return (
    <>
      <Select value={mode} onValueChange={(value) => setMode(value as ReferenceInsertMode)} disabled={busy}>
        <SelectTrigger aria-label={copy.referenceMode}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="FIXED">{copy.fixedReference}</SelectItem>
          <SelectItem value="FOLLOW" disabled={!canFollow}>
            {copy.followSource}
          </SelectItem>
          <SelectItem value="SYNC" disabled={!canFollow || !allowSync}>
            {copy.syncSource}
          </SelectItem>
          {allowLink && (
            <SelectItem value="LINK" disabled={!canLink}>
              {copy.insertLink}
            </SelectItem>
          )}
          {allowCopy && <SelectItem value="COPY">{copy.copyAsBody}</SelectItem>}
        </SelectContent>
      </Select>
      {(mode === 'FOLLOW' || mode === 'SYNC') && !canFollow && (
        <span role="status" className="text-xs text-muted-foreground">
          {copy.followScope}
        </span>
      )}
    </>
  );
}

function ReferenceSearchControls({
  category,
  setCategory,
  query,
  setQuery,
  onComposing,
}: {
  category: Category;
  setCategory(value: Category): void;
  query: string;
  setQuery(value: string): void;
  onComposing(value: boolean): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  return (
    <>
      <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
        <SelectTrigger aria-label={copy.choose}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CONTENT">{copy.sources}</SelectItem>
          <SelectItem value="CREATION_ITEM">{copy.items}</SelectItem>
          <SelectItem value="ALBUM">{copy.albums}</SelectItem>
        </SelectContent>
      </Select>
      <ContentSearchInput
        aria-label={copy.searchSources}
        placeholder={copy.searchSources}
        query={query}
        onQuery={setQuery}
        onComposing={onComposing}
      />
    </>
  );
}
