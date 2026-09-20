import { ContentSearchResults } from '@/renderer/features/content-search/ContentSearchResults';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
export { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, ChevronLeft, LoaderCircle } from 'lucide-react';
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

export function currentReferenceTarget(
  source: ReferenceSource,
  blockId?: string,
  section?: boolean,
  scope?: ReferenceScope,
): ReferenceTarget {
  return {
    source: isDocumentSource(source) ? { ...source, revisionId: undefined } : source,
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
        <Link2 className="size-3.5" />
        {menuItem && label}
      </Button>
    </PopoverTrigger>
  );
}
export function ContentReferencePicker({
  source,
  blockId,
  section,
  scope,
  label,
  menuItem = false,
  onInsert,
}: {
  source?: ReferenceSource;
  blockId?: string;
  section?: boolean;
  scope?: ReferenceScope;
  label?: string;
  menuItem?: boolean;
  onInsert(reference: ContentReference): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  const [open, setOpen] = useState(false);
  const menu = useContentMenuAction();
  const [category, setCategory] = useState<Category>('CONTENT');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [preview, setPreview] = useState<ReferencePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const searchOffset = useRef(0);
  const cancelPending = useCallback(() => {
    generation.current++;
  }, []);
  const requestedTarget = useRef<ReferenceTarget | null>(null);
  const sourceKey = source ? JSON.stringify(currentReferenceTarget(source, blockId, section, scope)) : '';
  const inspect = async (target: ReferenceTarget) => {
    const request = ++generation.current;
    requestedTarget.current = target;
    // A failed selection must not leave the previous block available for insertion.
    setPreview(null);
    setBusy(true);
    setError('');
    try {
      const result = await contentLibraryApi().referenceInspect(target);
      if (request !== generation.current) return;
      const expanded = await contentLibraryApi().render(result.markdown);
      if (request === generation.current)
        setPreview({
          ...result,
          markdown: expanded.markdown,
          media: [...result.media, ...expanded.media],
        });
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
    if (!preview || busy || error) return;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const reference = await contentLibraryApi().referenceCapture(preview.target, preview.version);
      if (request !== generation.current) return;
      onInsert(reference);
      menu.run(() => setOpen(false));
    } catch (reason) {
      if (request === generation.current) setError(referenceFailure(reason, copy));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        generation.current++;
        if (!value) setComposing(false);
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
              <ContentReferenceSelection preview={preview} busy={busy} onInspect={inspect} />
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
        <Button disabled={busy || !preview || Boolean(error)} onClick={() => void capture()}>
          {copy.insert}
        </Button>
      </PopoverContent>
    </Popover>
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
