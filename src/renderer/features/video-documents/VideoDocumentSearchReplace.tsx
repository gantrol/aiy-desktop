import type { Editor } from '@tiptap/core';
import { FindAndReplacePluginKey, findNextIndex, searchDocument } from '@tiptap/extension-find-and-replace';
import { useEditorState } from '@tiptap/react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaseSensitiveIcon,
  ReplaceIcon,
  SearchIcon,
  WholeWordIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import type { VideoDocumentWysiwygEditorLabels } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { commandMatchesShortcut } from '@/renderer/commands/app-shortcuts';
import { cn } from '@/renderer/lib/utils';

export type VideoDocumentSearchReplaceMode = 'search' | 'replace' | null;

interface Props {
  editor: Editor;
  labels: VideoDocumentWysiwygEditorLabels;
  mode: VideoDocumentSearchReplaceMode;
  onModeChange(mode: VideoDocumentSearchReplaceMode): void;
  onNavigate?(position: number): void;
}

interface SearchState {
  caseSensitive: boolean;
  currentIndex: number | null;
  total: number;
  wholeWord: boolean;
}

const emptySearchState: SearchState = {
  caseSensitive: false,
  currentIndex: null,
  total: 0,
  wholeWord: false,
};

function selectedText(editor: Editor) {
  const { from, to } = editor.state.selection;
  return from === to ? '' : editor.state.doc.textBetween(from, to, '\n', '\n');
}

function editorOwnsShortcut(editor: Editor) {
  const activeElement = document.activeElement;
  const editorRoot = editor.view.dom.closest('[data-slot="video-document-wysiwyg-editor"]');
  return activeElement !== null && editorRoot?.contains(activeElement) === true;
}

function scrollCurrentResultIntoView(editor: Editor) {
  window.requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const result = editor.view.dom.querySelector<HTMLElement>('.find-and-replace-result-current');
    result?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });
}

function findAndReplaceStorage(editor: Editor) {
  if (editor.isDestroyed) return null;
  return editor.storage.findAndReplace ?? null;
}

function selectResult(editor: Editor, direction: 1 | -1) {
  const storage = findAndReplaceStorage(editor);
  if (!storage) return null;
  const { currentIndex, results } = storage;
  if (!results.length) return null;
  const nextIndex =
    currentIndex === null
      ? direction === 1
        ? 0
        : results.length - 1
      : (currentIndex + direction + results.length) % results.length;
  editor.view.dispatch(editor.state.tr.setMeta(FindAndReplacePluginKey, { currentIndex: nextIndex }));
  scrollCurrentResultIntoView(editor);
  return results[nextIndex]?.from ?? null;
}

function replaceCurrentResult(editor: Editor) {
  const storage = findAndReplaceStorage(editor);
  if (!storage) return null;
  const { caseSensitive, currentIndex, replaceTerm, results, searchTerm, wholeWord } = storage;
  const result = results[currentIndex ?? 0];
  if (!result) return null;
  const transaction = editor.state.tr.insertText(replaceTerm, result.from, result.to);
  const nextResults = searchDocument(transaction.doc, searchTerm, {
    caseSensitive,
    useRegex: false,
    wholeWord,
  });
  const nextIndex = findNextIndex(nextResults, result.from + replaceTerm.length);
  transaction.setMeta(FindAndReplacePluginKey, { currentIndex: nextIndex });
  editor.view.dispatch(transaction);
  scrollCurrentResultIntoView(editor);
  return nextResults[nextIndex ?? 0]?.from ?? result.from;
}

function SearchIconButton({
  active,
  disabled = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn('size-8', active && 'bg-selected text-selected-foreground hover:bg-selected/80')}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="px-2 py-1">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function resultLabel(labels: VideoDocumentWysiwygEditorLabels, current: number, total: number) {
  return total ? labels.searchResultCount(current, total) : labels.noMatches;
}

export function VideoDocumentSearchReplace({ editor, labels, mode, onModeChange, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const queryRef = useRef(query);
  const previousModeRef = useRef<VideoDocumentSearchReplaceMode>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const state =
    useEditorState({
      editor,
      selector: ({ editor: current }): SearchState => {
        const storage = findAndReplaceStorage(current);
        if (!storage) return emptySearchState;
        return {
          caseSensitive: storage.caseSensitive,
          currentIndex: storage.currentIndex,
          total: storage.results.length,
          wholeWord: storage.wholeWord,
        };
      },
    }) ?? emptySearchState;
  const currentResult = state.currentIndex === null ? 0 : state.currentIndex + 1;
  const canNavigate = state.total > 0;

  useEffect(() => {
    const previousMode = previousModeRef.current;
    let focusFrame: number | null = null;
    if (mode !== null && previousMode === null) {
      const selection = selectedText(editor);
      const nextQuery = selection || queryRef.current;
      if (selection) {
        queryRef.current = selection;
        setQuery(selection);
      }
      if (nextQuery) editor.commands.setSearchTerm(nextQuery);
      else editor.commands.clearSearch();
      focusFrame = window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    } else if (mode === 'replace' && previousMode === 'search') {
      focusFrame = window.requestAnimationFrame(() => replaceInputRef.current?.focus());
    } else if (mode === 'search' && previousMode === 'replace') {
      focusFrame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    } else if (mode === null && previousMode !== null) {
      editor.commands.clearSearch();
      focusFrame = window.requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.commands.focus();
      });
    }
    previousModeRef.current = mode;
    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
    };
  }, [editor, mode]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const find = commandMatchesShortcut(event, window.desktopApi.appPlatform, 'document.find');
      const replace = commandMatchesShortcut(event, window.desktopApi.appPlatform, 'document.replace');
      if ((!find && !replace) || !editorOwnsShortcut(editor)) return;
      if (find) {
        event.preventDefault();
        if (mode === null) onModeChange('search');
        else {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      } else {
        event.preventDefault();
        if (mode !== 'replace') onModeChange('replace');
        else {
          const input = queryRef.current ? replaceInputRef.current : searchInputRef.current;
          input?.focus();
          input?.select();
        }
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [editor, mode, onModeChange]);

  function updateQuery(value: string) {
    queryRef.current = value;
    setQuery(value);
    if (value) editor.commands.setSearchTerm(value);
    else editor.commands.clearSearch();
  }

  function updateReplacement(value: string) {
    setReplacement(value);
    editor.commands.setReplaceTerm(value);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey)
      return;
    event.preventDefault();
    const position = selectResult(editor, event.shiftKey ? -1 : 1);
    if (position !== null) onNavigate?.(position);
  }

  return (
    <div
      hidden={mode === null}
      role="search"
      aria-label={labels.searchAndReplace}
      className="sticky top-9 z-20 border-b bg-surface px-2 py-2"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onModeChange(null);
      }}
    >
      <TooltipProvider delayDuration={450}>
        <div className="flex flex-wrap items-center gap-1.5">
          <SearchIconButton
            active={mode === 'replace'}
            label={mode === 'replace' ? labels.hideReplace : labels.showReplace}
            onClick={() => onModeChange(mode === 'replace' ? 'search' : 'replace')}
          >
            <ReplaceIcon className="size-3.5" />
          </SearchIconButton>
          <div className="relative min-w-48 flex-1">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              value={query}
              className="h-8 bg-background pl-8 pr-20 text-xs"
              aria-label={labels.search}
              placeholder={labels.search}
              onChange={(event) => updateQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <output
              aria-live="polite"
              aria-label={resultLabel(labels, currentResult, state.total)}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-2xs text-muted-foreground"
            >
              {currentResult} / {state.total}
            </output>
          </div>
          <SearchIconButton
            active={state.caseSensitive}
            label={labels.matchCase}
            onClick={() => editor.commands.setCaseSensitive(!state.caseSensitive)}
          >
            <CaseSensitiveIcon className="size-4" />
          </SearchIconButton>
          <SearchIconButton
            active={state.wholeWord}
            label={labels.wholeWord}
            onClick={() => editor.commands.setWholeWord(!state.wholeWord)}
          >
            <WholeWordIcon className="size-4" />
          </SearchIconButton>
          <span className="flex items-center gap-0.5">
            <SearchIconButton
              disabled={!canNavigate}
              label={labels.previousMatch}
              onClick={() => {
                const position = selectResult(editor, -1);
                if (position !== null) onNavigate?.(position);
              }}
            >
              <ArrowUpIcon className="size-3.5" />
            </SearchIconButton>
            <SearchIconButton
              disabled={!canNavigate}
              label={labels.nextMatch}
              onClick={() => {
                const position = selectResult(editor, 1);
                if (position !== null) onNavigate?.(position);
              }}
            >
              <ArrowDownIcon className="size-3.5" />
            </SearchIconButton>
            <SearchIconButton label={labels.closeSearch} onClick={() => onModeChange(null)}>
              <XIcon className="size-3.5" />
            </SearchIconButton>
          </span>
        </div>
        {mode === 'replace' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-9">
            <Input
              ref={replaceInputRef}
              value={replacement}
              className="h-8 min-w-48 flex-1 bg-background text-xs"
              aria-label={labels.replaceWith}
              placeholder={labels.replaceWith}
              onChange={(event) => updateReplacement(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!canNavigate}
              onClick={() => {
                const position = replaceCurrentResult(editor);
                if (position !== null) onNavigate?.(position);
              }}
            >
              {labels.replaceCurrent}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={!canNavigate}
              onClick={() => editor.commands.replaceAll()}
            >
              {labels.replaceAll}
            </Button>
          </div>
        )}
      </TooltipProvider>
    </div>
  );
}
