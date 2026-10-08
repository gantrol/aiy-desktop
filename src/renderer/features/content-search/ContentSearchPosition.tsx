import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ArrowDownIcon, ArrowUpIcon, SearchIcon, XIcon } from 'lucide-react';
import type { ContentSource } from '@/shared/contracts/content-source';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentSearchTargetContext } from '@/renderer/features/content-search/ContentSearchTargetContext';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import {
  contentSearchEditorMatches,
  contentSearchPositionKey,
  contentSearchPositionPlugin,
} from '@/renderer/features/content-search/contentSearchEditorMatches';
import {
  cancelEditorSearchReveal,
  revealEditorSearchMatch,
} from '@/renderer/features/content-editor/revealEditorSearchMatch';

export function ContentSearchPosition({
  editor,
  source,
  searching,
}: {
  editor: Editor;
  source?: ContentSource;
  searching: boolean;
}) {
  const target = useContext(ContentSearchTargetContext);
  const [dismissed, setDismissed] = useState<typeof target>();
  useEffect(() => {
    if (searching && target) setDismissed(target);
  }, [searching, target]);
  if (
    !target?.query.trim() ||
    !source ||
    dismissed === target ||
    searching ||
    contentSearchSourceKey(source) !== contentSearchSourceKey(target.source)
  )
    return null;
  return (
    <SearchPosition
      key={JSON.stringify(target)}
      editor={editor}
      query={target.query}
      onClose={() => setDismissed(target)}
    />
  );
}

function SearchPosition({ editor, query, onClose }: { editor: Editor; query: string; onClose(): void }) {
  const { messages, locale } = useI18n();
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const labels = messages.videoDocuments.editor.richText;
  const document = useEditorState({ editor, selector: ({ editor }) => editor.state.doc });
  const matches = useMemo(() => contentSearchEditorMatches(document, query), [document, query]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const index = Math.min(selectedIndex, Math.max(0, matches.length - 1));
  const initial = useRef(true);
  useEffect(() => {
    editor.registerPlugin(contentSearchPositionPlugin());
    return () => {
      cancelEditorSearchReveal(editor);
      if (!editor.isDestroyed) editor.unregisterPlugin(contentSearchPositionKey);
    };
  }, [editor]);
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(contentSearchPositionKey, { matches, index }));
    // Edits update highlights without repeatedly taking over the reader's scroll position.
    if (initial.current) {
      if (!matches.length) initial.current = false;
      else
        return revealEditorSearchMatch(editor, matches[index].from, `[data-content-search-index="${index}"]`, () => {
          initial.current = false;
        });
    }
  }, [editor, matches, index]);
  const navigate = (direction: number) => {
    if (!matches.length || editor.view.composing) return;
    const next = (index + direction + matches.length) % matches.length;
    setSelectedIndex(next);
    revealEditorSearchMatch(editor, matches[next].from, `[data-content-search-index="${next}"]`);
  };
  const close = () => {
    const match = matches[index];
    if (match && !editor.isDestroyed && !editor.view.composing) editor.commands.setTextSelection(match);
    onClose();
    if (!editor.isDestroyed) editor.commands.focus();
  };
  return (
    <div
      role="search"
      aria-label={labels.search}
      className="sticky top-0 z-20 flex items-center gap-2 border-b bg-surface px-3 py-2"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm" title={query}>
        {query}
      </span>
      <output
        aria-live="polite"
        aria-label={matches.length ? labels.searchResultCount(index + 1, matches.length) : labels.noMatches}
        className="text-xs tabular-nums text-muted-foreground"
      >
        {matches.length ? `${number.format(index + 1)} / ${number.format(matches.length)}` : labels.noMatches}
      </output>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={labels.previousMatch}
        title={labels.previousMatch}
        disabled={!matches.length}
        onClick={() => navigate(-1)}
      >
        <ArrowUpIcon className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={labels.nextMatch}
        title={labels.nextMatch}
        disabled={!matches.length}
        onClick={() => navigate(1)}
      >
        <ArrowDownIcon className="size-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={labels.closeSearch} title={labels.closeSearch} onClick={close}>
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
