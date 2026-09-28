import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronLeft, Ellipsis, X } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { OutlineAlbumLinkResults } from '@/renderer/features/content-editor/OutlineContentLinkDialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { ContentSearchInput } from '@/renderer/features/content-search/ContentSearchInput';
import { ContentSearchResults } from '@/renderer/features/content-search/ContentSearchResults';
import { ContentSearchHighlight } from '@/renderer/features/content-search/ContentSearchHighlight';
import { contentSearchTerms } from '@/shared/content-search-highlights';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import type { ContentLinkInput } from '@/shared/contracts/content-links';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import {
  contentAssociationFocusEvent,
  contentAssociationKey,
  dismissContentAssociation,
  insertContentAssociation,
  type ContentAssociationRequest,
} from '@/renderer/features/content-editor/contentAssociation';
import {
  contentAssociationMatches,
  type AssociationBlockMatch,
} from '@/renderer/features/content-editor/contentAssociationMatches';
import {
  setBracketAssociationsEnabled,
  useBracketAssociations,
} from '@/renderer/features/content-editor/contentAssociationPreferences';

export function ContentAssociationMenu({ editor }: { editor: Editor }) {
  const host = useOutlineContentLinkHost();
  const enabled = useBracketAssociations();
  const pending = useEditorState({
    editor,
    selector: ({ editor }) => contentAssociationKey.getState(editor.state) ?? null,
  });
  useEffect(() => {
    if (pending?.mode === 'AUTO' && !enabled) dismissContentAssociation(editor);
  }, [editor, pending, enabled]);
  if (!host || !pending || pending.composing || (pending.mode === 'AUTO' && !enabled) || !editor.isEditable)
    return null;
  return (
    <ContentAssociationPopup
      key={`${host.spaceId}:${host.articleId}:${pending.mode}:${pending.from}`}
      editor={editor}
      request={pending}
      spaceId={host.spaceId}
    />
  );
}

function useContentAssociationPopup({
  editor,
  request,
  spaceId,
}: {
  editor: Editor;
  request: ContentAssociationRequest;
  spaceId: string;
}) {
  const { messages } = useI18n();
  const copy = messages.contentEditor.association;
  const referenceCopy = messages.referenceOutline;
  const [manualQuery, setManualQuery] = useState(request.query);
  const [category, setCategory] = useState<'ARTICLE' | 'ALBUM'>('ARTICLE');
  const query = request.mode === 'AUTO' ? request.query : manualQuery;
  const terms = useMemo(() => contentSearchTerms(query), [query]);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ id: string; title: string; matches: AssociationBlockMatch[] } | null>(null);
  const [shown, setShown] = useState(30);
  const root = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const live = useRef(request);
  live.current = request;
  const cancelPending = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    generation.current++;
    setDetail(null);
    setError('');
    setBusy(false);
    running.current = false;
    return cancelPending;
  }, [query, cancelPending]);
  useEffect(() => {
    const focus = (event: Event) => {
      const first = root.current?.querySelector<HTMLButtonElement>('[data-search-result]:not(:disabled)');
      if (!first) return;
      event.preventDefault();
      first.focus({ preventScroll: true });
      first.scrollIntoView({ block: 'nearest' });
    };
    const view = request.view;
    view.dom.addEventListener(contentAssociationFocusEvent, focus);
    return () => {
      view.dom.removeEventListener(contentAssociationFocusEvent, focus);
    };
  }, [request.view]);
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          if (editor.isDestroyed || request.view.isDestroyed) return new DOMRect();
          const position = request.view.coordsAtPos(request.to);
          return new DOMRect(position.left, position.top, 1, position.bottom - position.top);
        },
      },
    }),
    [editor, request],
  );

  const perform = async (operation: (assertCurrent: () => void) => Promise<void>) => {
    if (running.current || composing) return;
    const captured = live.current;
    const document = editor.state.doc;
    const epoch = ++generation.current;
    const assertCurrent = () => {
      if (
        epoch !== generation.current ||
        editor.isDestroyed ||
        editor.state.doc !== document ||
        contentAssociationKey.getState(editor.state) !== captured ||
        captured.view.isDestroyed ||
        captured.view.composing
      )
        throw new Error('REFERENCE_TARGET_CHANGED');
    };
    running.current = true;
    setBusy(true);
    setError('');
    try {
      assertCurrent();
      await operation(assertCurrent);
    } catch (reason) {
      if (epoch === generation.current) setError(referenceFailure(reason, referenceCopy));
    } finally {
      if (epoch === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  };
  const commit = async (target: ContentLinkInput['target'], assertCurrent: () => void, label?: string) => {
    const result = await contentLibraryApi().linkResolve({ spaceId, target });
    assertCurrent();
    if (
      result.spaceId !== spaceId ||
      !insertContentAssociation(editor, live.current, result.url, label || result.title)
    )
      throw new Error('REFERENCE_TARGET_CHANGED');
  };
  const choose = (item: ContentLookupResult['items'][number]) =>
    void perform(async (assertCurrent) => {
      if (item.source.kind !== 'ARTICLE') throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
      const target = { kind: 'ARTICLE' as const, id: item.source.id };
      if (!query.trim() || item.match !== 'BODY') {
        await commit(target, assertCurrent);
        return;
      }
      const loaded = await contentLibraryApi().referenceOpen({ source: target });
      assertCurrent();
      if (loaded.spaceId !== spaceId) throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
      const matches = loaded.article.content.document
        ? contentAssociationMatches(loaded.article.content.document.root, query)
        : [];
      if (matches.length === 1) {
        await commit({ ...target, blockId: matches[0].blockId }, assertCurrent, matches[0].text.slice(0, 80));
      } else {
        setShown(30);
        setDetail({ id: target.id, title: loaded.article.content.title || referenceCopy.lookup.untitled, matches });
      }
    });
  const close = () => {
    generation.current++;
    dismissContentAssociation(editor);
  };
  const updateQuery = (value: string) => {
    generation.current++;
    setManualQuery(value);
    setDetail(null);
    setError('');
  };
  const updateComposing = (value: boolean) => {
    cancelPending();
    setComposing(value);
    running.current = false;
    setBusy(false);
  };
  const changeCategory = (value: string) => {
    if (value !== 'ARTICLE' && value !== 'ALBUM') return;
    cancelPending();
    setCategory(value);
    setDetail(null);
    setError('');
    running.current = false;
    setBusy(false);
  };
  const chooseAlbum = (id: string) => void perform((assert) => commit({ kind: 'ALBUM', id }, assert));
  return {
    copy,
    referenceCopy,
    manualQuery,
    query,
    terms,
    composing,
    busy,
    error,
    detail,
    setDetail,
    shown,
    setShown,
    root,
    anchor,
    perform,
    commit,
    choose,
    close,
    updateQuery,
    updateComposing,
    category,
    changeCategory,
    chooseAlbum,
  };
}

function ContentAssociationPopup(props: { editor: Editor; request: ContentAssociationRequest; spaceId: string }) {
  const { request } = props;
  const {
    copy,
    referenceCopy,
    manualQuery,
    query,
    terms,
    composing,
    busy,
    error,
    detail,
    setDetail,
    shown,
    setShown,
    root,
    anchor,
    perform,
    commit,
    choose,
    close,
    updateQuery,
    updateComposing,
    category,
    changeCategory,
    chooseAlbum,
  } = useContentAssociationPopup(props);
  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        ref={root}
        align="start"
        side="bottom"
        className="flex max-h-[min(28rem,70vh)] w-[min(26rem,calc(100vw-2rem))] flex-col gap-1 rounded-sm p-1 shadow-none"
        aria-label={copy.find}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (request.mode === 'MANUAL') root.current?.querySelector('input')?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => {
          if (request.view.dom.contains(event.target as Node)) event.preventDefault();
        }}
        onEscapeKeyDown={() => {
          close();
          if (!request.view.isDestroyed) request.view.focus();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (
            event.nativeEvent.isComposing ||
            event.key !== 'ArrowDown' ||
            event.target !== root.current?.querySelector('input')
          )
            return;
          const first = root.current.querySelector<HTMLButtonElement>('[data-search-result]:not(:disabled)');
          if (first) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="flex items-center gap-1 px-1">
          {detail && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={referenceCopy.back}
              disabled={busy}
              onClick={() => setDetail(null)}
            >
              <ChevronLeft />
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {detail?.title || (category === 'ALBUM' ? referenceCopy.albums : referenceCopy.linkDocuments)}
          </span>
          {request.mode === 'AUTO' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={copy.options}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setBracketAssociationsEnabled(false);
                    close();
                  }}
                >
                  {copy.disable}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copy.close}
            onClick={() => {
              close();
              request.view.focus();
            }}
          >
            <X />
          </Button>
        </div>
        {request.mode === 'MANUAL' && (
          <Segmented type="single" value={category} onValueChange={changeCategory} className="mx-1">
            <SegmentedItem value="ARTICLE">{referenceCopy.linkDocuments}</SegmentedItem>
            <SegmentedItem value="ALBUM">{referenceCopy.albums}</SegmentedItem>
          </Segmented>
        )}
        {request.mode === 'MANUAL' && (
          <ContentSearchInput
            query={manualQuery}
            onQuery={updateQuery}
            aria-label={copy.find}
            placeholder={referenceCopy.lookup.placeholder}
            onComposing={updateComposing}
          />
        )}
        {error && (
          <span role="alert" className="px-2 py-1 text-xs text-destructive">
            {error}
          </span>
        )}
        {busy && (
          <span role="status" className="px-2 text-xs text-muted-foreground">
            {copy.loading}
          </span>
        )}
        {detail ? (
          <div
            className="min-h-0 overflow-y-auto"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-search-result]:not(:disabled)'),
              );
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
            }}
          >
            <Button
              variant="ghost"
              className="w-full justify-start"
              data-search-result="whole"
              disabled={busy}
              onClick={() => void perform((assert) => commit({ kind: 'ARTICLE', id: detail.id }, assert))}
            >
              {referenceCopy.whole}
            </Button>
            {!detail.matches.length && (
              <span role="status" className="block px-3 py-2 text-xs text-muted-foreground">
                {copy.noBlock}
              </span>
            )}
            {detail.matches.slice(0, shown).map((match) => (
              <Button
                key={match.blockId}
                variant="ghost"
                disabled={busy}
                className="h-auto w-full justify-start rounded-sm py-2 text-left whitespace-normal"
                data-search-result={match.blockId}
                onClick={() =>
                  void perform((assert) =>
                    commit({ kind: 'ARTICLE', id: detail.id, blockId: match.blockId }, assert, match.text.slice(0, 80)),
                  )
                }
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm">
                    <ContentSearchHighlight text={match.text} terms={terms} />
                  </span>
                  {match.path && <span className="truncate text-xs text-muted-foreground">{match.path}</span>}
                </span>
              </Button>
            ))}
            {detail.matches.length > shown && (
              <Button variant="ghost" onClick={() => setShown((count) => count + 30)}>
                {referenceCopy.more}
              </Button>
            )}
          </div>
        ) : category === 'ALBUM' ? (
          <OutlineAlbumLinkResults query={query} disabled={busy || composing} onSelect={chooseAlbum} />
        ) : (
          <ContentSearchResults
            type="ARTICLE"
            query={query}
            enabled={!composing && !busy}
            disabled={busy}
            onSelect={choose}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
