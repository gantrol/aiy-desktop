import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { registerWorkspaceDrain } from '@/renderer/components/workspace/workspace-drain';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  creationReadingSchema,
  emptyCreationReading,
  readingFileByteLimit,
  type CreationReading,
  type ReadingEntry,
  type ReadingSource,
  type ReadingPosition,
} from '@/shared/contracts/creation-reading';
import type { HtmlFileAttributes } from '@/shared/contracts/html-file';
import type { ReadingSelection, ReadingReveal } from '@/renderer/features/creation-reading/ReadingText';
import type { ReadingCitationLink } from '@/shared/reading-citation-link';
import { readingLocationText } from '@/renderer/features/creation-reading/readingEntryText';
import { useReadingPositions } from '@/renderer/features/creation-reading/useReadingPositions';

import { useReadingLayout } from '@/renderer/features/creation-reading/useReadingLayout';
export type { ReadingLayout } from '@/renderer/features/creation-reading/useReadingLayout';
export function useCreationReadingWorkspace(spaceId: string) {
  const { locale, messages } = useI18n();
  const copy = messages.creationReading;
  const session = useArticleEditorSession();
  const saved = useArticleEditorSessionSelector((state) => state.draft.metadata.reading);
  const reading = useMemo(() => saved ?? emptyCreationReading(), [saved]);
  const articleId = session.capturePersistedArticle().id;
  const [opened, setOpened] = useState(false);
  const [started, setStarted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const geometry = useReadingLayout(opened);
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  const [revealLocation, setRevealLocation] = useState<ReadingReveal>();
  const [returnPoint, setReturnPoint] = useState<{
    sourceId: string | null;
    position?: ReadingPosition;
    opened: boolean;
    focus?: () => void;
  } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [previewRequest, setPreviewRequest] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const referenceTrigger = useRef<HTMLElement | null>(null);
  const mounted = useRef(true),
    pending = useRef<Promise<void> | null>(null);
  const navigation = useRef(0);
  const previewSequence = useRef(0);
  const source = reading.sources.find((item) => item.id === reading.activeSourceId);
  const onPositionFailure = useStableCallback(() => setError(copy.failed));
  const { flushPositions, rememberPosition, positionFor } = useReadingPositions(session, onPositionFailure);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () =>
      registerWorkspaceDrain(async () => {
        flushPositions();
        if (pending.current) await pending.current;
        if (!(await session.flush('manual'))) throw new Error('READING_SAVE_FAILED');
      }),
    [flushPositions, session],
  );

  const update = useStableCallback((change: (current: CreationReading) => CreationReading) => {
    try {
      const current = session.model.getSnapshot().draft.metadata.reading ?? emptyCreationReading();
      session.readingChanged(creationReadingSchema.parse(change(current)));
      setError('');
      return true;
    } catch {
      setError(copy.limit);
      return false;
    }
  });
  const run = useStableCallback((action: () => Promise<void>) => {
    if (pending.current) return pending.current;
    setBusy(true);
    setError('');
    const operation = action()
      .catch(() => {
        if (mounted.current) setError(copy.failed);
      })
      .finally(() => {
        pending.current = null;
        if (mounted.current) setBusy(false);
      });
    pending.current = operation;
    return operation;
  });
  const reveal = useStableCallback((trigger?: HTMLElement) => {
    if (trigger) referenceTrigger.current = trigger;
    navigation.current++;
    setStarted(true);
    setOpened(true);
  });
  const closeReferences = useStableCallback(() => {
    const returnFocus = returnPoint?.focus;
    flushPositions();
    setSelection(null);
    setRevealLocation(undefined);
    setReturnPoint(null);
    navigation.current++;
    setOpened(false);
    requestAnimationFrame(() => {
      if (!mounted.current) return;
      if (returnFocus) returnFocus();
      else if (referenceTrigger.current?.isConnected) referenceTrigger.current.focus();
    });
  });
  const choose = useStableCallback((id: string) => {
    flushPositions();
    setReturnPoint(null);
    setRevealLocation(undefined);
    update((current) => ({ ...current, activeSourceId: id }));
    setSelection(null);
    setPreviewRequest(0);
    reveal();
  });
  const openSource = useStableCallback(
    (id: string, location: ReadingEntry['location'], quote: string = '', focus?: () => void) => {
      const current = session.model.getSnapshot().draft.metadata.reading;
      if (!current?.sources.some((item) => item.id === id)) return false;
      const previousId = current.activeSourceId;
      const back = { sourceId: previousId, position: previousId ? positionFor(previousId) : undefined, opened, focus };
      choose(id);
      setReturnPoint(back);
      setRevealLocation({ location, quote });
      return true;
    },
  );
  const openCitation = useStableCallback((target: ReadingCitationLink, focus: () => void) => {
    if (target.articleId !== articleId) return false;
    const citation = session.model
      .getSnapshot()
      .draft.metadata.reading?.citations?.find((item) => item.id === target.citationId);
    return Boolean(citation && openSource(citation.sourceId, citation.location, citation.quote, focus));
  });
  const returnFromSource = useStableCallback(() => {
    if (!returnPoint) return;
    navigation.current++;
    flushPositions();
    const back = returnPoint;
    setReturnPoint(null);
    setSelection(null);
    setPreviewRequest(0);
    if (back.sourceId) {
      update((current) => ({ ...current, activeSourceId: back.sourceId }));
      setRevealLocation({ location: { page: back.position?.page }, position: back.position });
    } else setRevealLocation(undefined);
    setOpened(back.opened);
    requestAnimationFrame(() => {
      if (mounted.current) back.focus?.();
    });
  });
  const onRevealFailed = useStableCallback(() => setError(copy.locationMissing));
  const quoteSelection = useStableCallback(() => {
    if (!source || !selection?.text.trim()) return;
    const label = [source.title || copy.source, readingLocationText(selection, copy.page, locale)]
      .filter(Boolean)
      .join(' · ');
    if (!session.appendReadingText(selection.text, { sourceId: source.id, location: selection.location, label }))
      setError(copy.quoteFailed);
    else setError('');
  });
  const addSource = useStableCallback(async (item: ReadingSource, request: number) => {
    if (!mounted.current) return;
    if (
      !update((current) => ({
        ...current,
        sources: current.sources.some((source) => source.id === item.id) ? current.sources : [...current.sources, item],
        activeSourceId: request === navigation.current ? item.id : current.activeSourceId,
      }))
    )
      return;
    // Readers only reopen file identities already retained in the article revision.
    if (!(await session.flush('manual'))) throw new Error('READING_SAVE_FAILED');
    if (!mounted.current || request !== navigation.current) return false;
    setSelection(null);
    setRevealLocation(undefined);
    setReturnPoint(null);
    setPreviewRequest(0);
    reveal();
    return true;
  });
  const openHtml = useStableCallback((file: HtmlFileAttributes) => {
    const request = ++navigation.current;
    void run(async () => {
      if (file.spaceId !== spaceId) throw new Error('READING_SPACE_CHANGED');
      if (await addSource({ kind: 'HTML', id: 'html:' + file.objectHash, title: file.fileName, file }, request))
        setPreviewRequest(++previewSequence.current);
    });
  });
  const host = useMemo(
    () => ({ openHtml, openReferences: reveal, closeReferences, referencesOpen: opened, openCitation }),
    [openHtml, reveal, closeReferences, opened, openCitation],
  );
  const importFile = useStableCallback((file: File) => {
    const request = ++navigation.current;
    void run(async () => {
      if (!/\.(pdf|html?|txt|md)$/i.test(file.name)) throw new Error('READING_FORMAT_UNSUPPORTED');
      if (!file.size || file.size > readingFileByteLimit) throw new Error('READING_FILE_LIMIT');
      if (/\.(txt|md)$/i.test(file.name) && file.size > 1_000_000) throw new Error('READING_FILE_LIMIT');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!mounted.current) return;
      if (/\.html?$/i.test(file.name)) {
        const html = await window.desktopApi.htmlFileImport({ spaceId, fileName: file.name, bytes });
        if (await addSource({ kind: 'HTML', id: 'html:' + html.objectHash, title: html.fileName, file: html }, request))
          setPreviewRequest(++previewSequence.current);
      } else {
        const stored = await window.desktopApi.readingFileImport({ spaceId, name: file.name, bytes });
        await addSource({ kind: 'FILE', id: 'file:' + stored.id, title: stored.name, file: stored }, request);
      }
    });
  });
  const addNote = useStableCallback(() => {
    const entry: ReadingEntry = {
      id: crypto.randomUUID(),
      sourceId: source?.id ?? null,
      kind: 'NOTE',
      location: selection?.location ?? {},
      quote: selection?.text ?? '',
      text: '',
    };
    if (update((current) => ({ ...current, entries: [...current.entries, entry] }))) setNotesOpen(true);
  });
  const editEntry = useStableCallback((id: string, change: Partial<ReadingEntry>) => {
    update((current) => ({
      ...current,
      entries: current.entries.map((item) => (item.id === id ? { ...item, ...change } : item)),
    }));
  });
  return {
    ...geometry,
    copy,
    reading,
    articleId,
    closeReferences,
    started,
    menuOpen,
    setMenuOpen,
    input,
    source,
    selection,
    setSelection,
    revealLocation,
    rememberPosition,
    openSource,
    returnPoint,
    returnFromSource,
    onRevealFailed,
    quoteSelection,
    notesOpen,
    setNotesOpen,
    previewRequest,
    busy,
    error,
    setError,
    update,
    choose,
    host,
    importFile,
    addNote,
    editEntry,
    spaceId,
  };
}
export type ReadingWorkspace = ReturnType<typeof useCreationReadingWorkspace>;
