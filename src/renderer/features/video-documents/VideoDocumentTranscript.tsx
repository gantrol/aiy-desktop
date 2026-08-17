import { CheckIcon, CopyIcon, LoaderCircleIcon, PencilIcon, SaveIcon, SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentTimedTranscriptContent,
  VideoDocumentTranscriptCue,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
  VideoDocumentTranscriptCueI18nEditor,
  normalizeTranscriptCueI18nDraft,
  transcriptCueLocalizedText,
  transcriptCueI18nDraft,
  type VideoDocumentTranscriptCueI18nDraft,
} from '@/renderer/features/video-documents/VideoDocumentTranscriptCueI18nEditor';
import {
  ORIGINAL_TRANSCRIPT_LANGUAGE,
  VideoDocumentTranscriptLanguageBar,
  type VideoDocumentTranscriptDisplayMode,
  useVideoDocumentTranscriptLanguageView,
} from '@/renderer/features/video-documents/VideoDocumentTranscriptLanguageBar';
import { VideoDocumentTranscriptNavigator } from '@/renderer/features/video-documents/VideoDocumentTranscriptNavigator';
import type { VideoDocumentTimelineSegment } from '@/renderer/features/video-documents/VideoDocumentTimeline';
import {
  VideoDocumentToolbar,
  VideoDocumentToolbarAction,
} from '@/renderer/features/video-documents/VideoDocumentToolbar';
import { useVideoDocumentTranscriptViewport } from '@/renderer/features/video-documents/useVideoDocumentTranscriptViewport';
import type { VideoDocumentTranscriptTranslationProgress } from '@/renderer/features/video-documents/useVideoDocumentTranscriptTranslation';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface VideoDocumentTranscriptLabels {
  timeline?: string;
}

interface Props {
  revision: VideoDocumentRevisionDto;
  currentTimeMs?: number;
  durationMs?: number;
  segments?: readonly VideoDocumentTimelineSegment[];
  labels?: VideoDocumentTranscriptLabels;
  toolbarActions?: ReactNode;
  toolbarTarget?: HTMLElement | null;
  onSave?(content: VideoDocumentRevisionContent): Promise<void>;
  translating?: boolean;
  translationProgress?: VideoDocumentTranscriptTranslationProgress | null;
  translationCancelling?: boolean;
  onTranslate?(): void;
  onCancelTranslation?(): void;
  onSeek(timestampMs: number): void;
}

function formatTimestamp(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function transcriptCuePresentation(
  cue: VideoDocumentTranscriptCue,
  selectedLanguage: string,
  displayMode: VideoDocumentTranscriptDisplayMode,
) {
  if (selectedLanguage === ORIGINAL_TRANSCRIPT_LANGUAGE) {
    return { primary: cue.text, primaryLocale: cue.textLocale, secondary: null, secondaryLocale: null };
  }
  const translation = transcriptCueLocalizedText(cue, selectedLanguage);
  if (displayMode === 'BILINGUAL') {
    return {
      primary: cue.text,
      primaryLocale: cue.textLocale,
      secondary: translation && translation !== cue.text ? translation : null,
      secondaryLocale: translation && translation !== cue.text ? selectedLanguage : null,
    };
  }
  return {
    primary: translation ?? cue.text,
    primaryLocale: translation ? selectedLanguage : cue.textLocale,
    secondary: null,
    secondaryLocale: null,
  };
}

function htmlLanguage(locale: string | null | undefined) {
  return locale && locale !== 'und' ? locale : undefined;
}

interface TranscriptToolbarProps {
  actions?: ReactNode;
  target: HTMLElement | null;
  canEdit: boolean;
  editing: boolean;
  saving: boolean;
  saveDisabled: boolean;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  editLabel: string;
  cancelLabel: string;
  saveLabel: string;
  savingLabel: string;
  onCopy(): void;
  onEdit(): void;
  onCancel(): void;
  onSave(): void;
}

function TranscriptToolbar({
  actions,
  target,
  canEdit,
  editing,
  saving,
  saveDisabled,
  copied,
  copyLabel,
  copiedLabel,
  editLabel,
  cancelLabel,
  saveLabel,
  savingLabel,
  onCopy,
  onEdit,
  onCancel,
  onSave,
}: TranscriptToolbarProps) {
  return (
    <VideoDocumentToolbar target={target}>
      {!editing && actions}
      {!editing && (
        <VideoDocumentToolbarAction
          type="button"
          icon={copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          label={copied ? copiedLabel : copyLabel}
          onClick={onCopy}
        />
      )}
      {canEdit && !editing && (
        <VideoDocumentToolbarAction
          type="button"
          icon={<PencilIcon className="size-4" />}
          label={editLabel}
          onClick={onEdit}
        />
      )}
      {editing && (
        <>
          <VideoDocumentToolbarAction
            type="button"
            disabled={saving}
            icon={<XIcon className="size-4" />}
            label={cancelLabel}
            onClick={onCancel}
          />
          <VideoDocumentToolbarAction
            type="button"
            variant="default"
            disabled={saveDisabled}
            icon={saving ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
            label={saving ? savingLabel : saveLabel}
            onClick={onSave}
          />
        </>
      )}
    </VideoDocumentToolbar>
  );
}

interface TranscriptHeaderProps {
  content: VideoDocumentTimedTranscriptContent;
  editing: boolean;
  query: string;
  visibleCueCount: number;
  selectedLanguage: string;
  displayMode: VideoDocumentTranscriptDisplayMode;
  onQueryChange(query: string): void;
  onLanguageChange(language: string): void;
  onDisplayModeChange(mode: VideoDocumentTranscriptDisplayMode): void;
  translating: boolean;
  translationProgress: VideoDocumentTranscriptTranslationProgress | null;
  translationCancelling: boolean;
  onTranslate?(): void;
  onCancelTranslation?(): void;
}

function TranscriptHeader({
  content,
  editing,
  query,
  visibleCueCount,
  selectedLanguage,
  displayMode,
  onQueryChange,
  onLanguageChange,
  onDisplayModeChange,
  translating,
  translationProgress,
  translationCancelling,
  onTranslate,
  onCancelTranslation,
}: TranscriptHeaderProps) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.transcript;
  return (
    <>
      <div className="flex min-w-0 items-center gap-2 border-b py-3 text-xs text-muted-foreground">
        <span>{labels.sourceType[content.transcriptBasis]}</span>
        <span aria-hidden="true">·</span>
        <span>{labels.textTreatment[content.textTreatment]}</span>
        <span aria-hidden="true">·</span>
        <span>{labels.cueCount(content.cues.length)}</span>
        <span className="ml-auto max-w-64 truncate" title={content.sourceFileName}>
          {content.sourceFileName}
        </span>
      </div>
      {!editing && (
        <>
          <VideoDocumentTranscriptLanguageBar
            content={content}
            selectedLanguage={selectedLanguage}
            displayMode={displayMode}
            onLanguageChange={onLanguageChange}
            onDisplayModeChange={onDisplayModeChange}
            translating={translating}
            translationProgress={translationProgress}
            translationCancelling={translationCancelling}
            onTranslate={onTranslate}
            onCancelTranslation={onCancelTranslation}
          />
          <div className="flex items-center gap-2 border-b py-3">
            <label className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                className="h-9 pl-9 pr-9"
                placeholder={labels.search}
                aria-label={labels.search}
                onChange={(event) => onQueryChange(event.target.value)}
              />
              {query && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  aria-label={labels.clearSearch}
                  onClick={() => onQueryChange('')}
                >
                  <XIcon className="size-3.5" />
                </Button>
              )}
            </label>
            <span className="shrink-0 text-xs text-muted-foreground">
              {labels.matchCount(visibleCueCount, content.cues.length)}
            </span>
          </div>
        </>
      )}
    </>
  );
}

interface TranscriptCueListProps {
  cues: readonly VideoDocumentTranscriptCue[];
  editing: boolean;
  activeCueSourceIndex: number | null;
  focusedCueSourceIndex: number | null;
  cueIndexBySource: ReadonlyMap<number, number>;
  draftCueTexts: readonly string[];
  editingCueSourceIndex: number | null;
  draftCueI18n: VideoDocumentTranscriptCueI18nDraft | null;
  saving: boolean;
  canEdit: boolean;
  selectedLanguage: string;
  displayMode: VideoDocumentTranscriptDisplayMode;
  onCueRef(sourceIndex: number, element: HTMLLIElement | null): void;
  onFocusCue(sourceIndex: number): void;
  onSeek(timestampMs: number): void;
  onDraftCueTextChange(cueIndex: number, text: string): void;
  onDraftCueI18nChange(draft: VideoDocumentTranscriptCueI18nDraft): void;
  onSaveTranscript(): void;
  onSaveCue(sourceIndex: number): void;
  onStartCueEdit(cue: VideoDocumentTranscriptCue): void;
  onCancelCueEdit(): void;
}

function TranscriptCueList({
  cues,
  editing,
  activeCueSourceIndex,
  focusedCueSourceIndex,
  cueIndexBySource,
  draftCueTexts,
  editingCueSourceIndex,
  draftCueI18n,
  saving,
  canEdit,
  selectedLanguage,
  displayMode,
  onCueRef,
  onFocusCue,
  onSeek,
  onDraftCueTextChange,
  onDraftCueI18nChange,
  onSaveTranscript,
  onSaveCue,
  onStartCueEdit,
  onCancelCueEdit,
}: TranscriptCueListProps) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.transcript;
  return (
    <ol id="video-document-transcript-cues" className="divide-y">
      {cues.map((cue) => {
        const timestamp = formatTimestamp(cue.startTimestampMs);
        const active = cue.sourceIndex === activeCueSourceIndex;
        const focused = cue.sourceIndex === focusedCueSourceIndex;
        const cueIndex = cueIndexBySource.get(cue.sourceIndex) ?? 0;
        const editingCue = !editing && editingCueSourceIndex === cue.sourceIndex;
        const cueI18nDraft = editingCue ? (draftCueI18n ?? transcriptCueI18nDraft(cue)) : null;
        const normalizedCueI18nDraft = cueI18nDraft ? normalizeTranscriptCueI18nDraft(cueI18nDraft) : null;
        const presentation = transcriptCuePresentation(cue, selectedLanguage, displayMode);
        return (
          <li
            key={cue.sourceIndex}
            ref={(element) => onCueRef(cue.sourceIndex, element)}
            data-cue-source-index={cue.sourceIndex}
            data-focused={focused ? '' : undefined}
            data-video-current={active ? '' : undefined}
            className={cn('group/cue scroll-mt-4 rounded-md py-3 transition-colors', focused && 'bg-selected/45')}
          >
            {editing ? (
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className="mt-2 shrink-0 rounded-sm font-mono text-xs tabular-nums text-muted-foreground outline-none hover:text-selected-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-current={active ? 'time' : undefined}
                  onClick={() => onSeek(cue.startTimestampMs)}
                >
                  {timestamp}
                </button>
                <Textarea
                  value={draftCueTexts[cueIndex] ?? cue.text}
                  aria-label={messages.videoDocuments.editor.transcriptCue(timestamp)}
                  className="min-h-16 resize-y text-[15px] leading-7"
                  onFocus={() => onFocusCue(cue.sourceIndex)}
                  onChange={(event) => onDraftCueTextChange(cueIndex, event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
                      event.preventDefault();
                      onSaveTranscript();
                    }
                  }}
                />
              </div>
            ) : editingCue ? (
              <div className="flex items-start gap-2 px-3">
                <button
                  type="button"
                  className="mt-2 shrink-0 rounded-sm font-mono text-xs tabular-nums text-muted-foreground outline-none hover:text-selected-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-current={active ? 'time' : undefined}
                  onClick={() => onSeek(cue.startTimestampMs)}
                >
                  {timestamp}
                </button>
                <div
                  className="min-w-0 flex-1"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onCancelCueEdit();
                      return;
                    }
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      (event.key === 'Enter' || event.key.toLocaleLowerCase() === 's')
                    ) {
                      event.preventDefault();
                      onSaveCue(cue.sourceIndex);
                    }
                  }}
                >
                  <VideoDocumentTranscriptCueI18nEditor
                    autoFocus
                    defaultOpen={selectedLanguage !== ORIGINAL_TRANSCRIPT_LANGUAGE}
                    draft={cueI18nDraft!}
                    labels={labels.i18n}
                    onChange={onDraftCueI18nChange}
                  />
                  {!normalizedCueI18nDraft && <p className="mt-1 text-xs text-destructive">{labels.i18n.invalid}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={saving}
                    aria-label={messages.videoDocuments.editor.cancelCue(timestamp)}
                    title={messages.videoDocuments.editor.cancel}
                    onClick={onCancelCueEdit}
                  >
                    <XIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    disabled={saving || !normalizedCueI18nDraft}
                    aria-label={messages.videoDocuments.editor.saveCue(timestamp)}
                    title={messages.videoDocuments.editor.save}
                    onClick={() => onSaveCue(cue.sourceIndex)}
                  >
                    {saving ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 px-3">
                <button
                  type="button"
                  className={cn(
                    'mt-1 shrink-0 rounded-sm font-mono text-xs leading-7 tabular-nums text-muted-foreground outline-none transition-colors hover:text-selected-foreground focus-visible:ring-2 focus-visible:ring-ring',
                    active && 'font-medium text-selected-foreground',
                  )}
                  aria-label={labels.openAt(timestamp)}
                  aria-current={active ? 'time' : undefined}
                  onClick={() => onSeek(cue.startTimestampMs)}
                >
                  {timestamp}
                </button>
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onFocusCue(cue.sourceIndex)}
                >
                  <p
                    lang={htmlLanguage(presentation.primaryLocale)}
                    className="whitespace-pre-line text-[15px] leading-7 text-foreground"
                  >
                    {presentation.primary}
                  </p>
                  {presentation.secondary && (
                    <p
                      lang={htmlLanguage(presentation.secondaryLocale)}
                      className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground"
                    >
                      {presentation.secondary}
                    </p>
                  )}
                </button>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover/cue:opacity-100 focus-visible:opacity-100"
                    disabled={saving || editingCueSourceIndex !== null}
                    aria-label={messages.videoDocuments.editor.editCue(timestamp)}
                    title={messages.videoDocuments.editor.edit}
                    onClick={() => {
                      onFocusCue(cue.sourceIndex);
                      onStartCueEdit(cue);
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function transcriptTimelineDuration(
  content: VideoDocumentTimedTranscriptContent,
  segments: readonly VideoDocumentTimelineSegment[],
  durationMs: number | undefined,
) {
  const inferred = Math.max(
    content.cues.at(-1)?.endTimestampMs ?? 0,
    ...segments.map((segment) => segment.endTimestampMs),
  );
  return Math.max(0, durationMs ?? inferred);
}

function transcriptCopyText(
  content: VideoDocumentTimedTranscriptContent,
  selectedLanguage: string,
  displayMode: VideoDocumentTranscriptDisplayMode,
) {
  return content.cues
    .map((cue) => {
      const presentation = transcriptCuePresentation(cue, selectedLanguage, displayMode);
      const lines = [`[${formatTimestamp(cue.startTimestampMs)}] ${presentation.primary}`];
      if (presentation.secondary) lines.push(presentation.secondary);
      return lines.join('\n');
    })
    .join('\n');
}

export function VideoDocumentTranscript({
  revision,
  currentTimeMs = 0,
  durationMs,
  segments = [],
  labels: suppliedLabels,
  toolbarActions,
  toolbarTarget,
  onSave,
  translating = false,
  translationProgress = null,
  translationCancelling = false,
  onTranslate,
  onCancelTranslation,
  onSeek,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.transcript;
  const content = revision.content.format === 'TIMED_TRANSCRIPT' ? revision.content : null;
  const [query, setQuery] = useState('');
  const { selectedLanguage, displayMode, selectLanguage, setDisplayMode } =
    useVideoDocumentTranscriptLanguageView(content);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftCueTexts, setDraftCueTexts] = useState<string[]>([]);
  const [editingCueSourceIndex, setEditingCueSourceIndex] = useState<number | null>(null);
  const [draftCueI18n, setDraftCueI18n] = useState<VideoDocumentTranscriptCueI18nDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [focusedCueSourceIndex, setFocusedCueSourceIndex] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const cueRefs = useRef(new Map<number, HTMLLIElement>());
  const [pendingScrollSourceIndex, setPendingScrollSourceIndex] = useState<number | null>(null);

  useEffect(() => {
    setQuery('');
    setCopied(false);
    setEditing(false);
    setDraftCueTexts(content?.cues.map((cue) => cue.text) ?? []);
    setEditingCueSourceIndex(null);
    setDraftCueI18n(null);
    setSaveError('');
    setFocusedCueSourceIndex(null);
    setPendingScrollSourceIndex(null);
    cueRefs.current.clear();
  }, [content?.cues, revision.id]);

  const visibleCues = useMemo(() => {
    if (!content) return [];
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? content.cues.filter((cue) => {
          const presentation = transcriptCuePresentation(cue, selectedLanguage, displayMode);
          return [presentation.primary, presentation.secondary]
            .filter((text): text is string => Boolean(text))
            .some((text) => text.toLocaleLowerCase().includes(normalized));
        })
      : content.cues;
  }, [content, displayMode, query, selectedLanguage]);
  const cueIndexBySource = useMemo(
    () => new Map((content?.cues ?? []).map((cue, index) => [cue.sourceIndex, index])),
    [content],
  );

  const activeCueSourceIndex = useMemo(() => {
    if (!content) return null;
    return (
      content.cues.find(
        (cue) =>
          currentTimeMs >= cue.startTimestampMs &&
          currentTimeMs < Math.max(cue.endTimestampMs, cue.startTimestampMs + 1),
      )?.sourceIndex ?? null
    );
  }, [content, currentTimeMs]);

  const renderedCues = editing ? (content?.cues ?? []) : visibleCues;
  const viewportRange = useVideoDocumentTranscriptViewport({ sectionRef, cueRefs, cues: renderedCues });
  const focusedCue = useMemo(
    () => content?.cues.find((cue) => cue.sourceIndex === focusedCueSourceIndex) ?? null,
    [content, focusedCueSourceIndex],
  );

  useEffect(() => {
    if (pendingScrollSourceIndex === null) return undefined;
    const frame = window.requestAnimationFrame(() => {
      cueRefs.current.get(pendingScrollSourceIndex)?.scrollIntoView({ block: 'center' });
      setPendingScrollSourceIndex(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingScrollSourceIndex, visibleCues]);

  if (!content) return null;

  const timelineDurationMs = transcriptTimelineDuration(content, segments, durationMs);

  async function copyTranscript() {
    await navigator.clipboard.writeText(transcriptCopyText(content!, selectedLanguage, displayMode));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  async function saveTranscript() {
    if (!onSave || saving || draftCueTexts.some((text) => !text.trim())) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...content!,
        textTreatment: 'CLEANED',
        cues: content!.cues.map((cue, index) => ({ ...cue, text: draftCueTexts[index]!.trim() })),
      });
      setEditing(false);
    } catch {
      setSaveError(messages.videoDocuments.editor.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function saveCue(sourceIndex: number) {
    const nextCue = draftCueI18n ? normalizeTranscriptCueI18nDraft(draftCueI18n) : null;
    if (!onSave || saving || !nextCue) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...content!,
        schemaVersion: 2,
        textTreatment: 'CLEANED',
        cues: content!.cues.map((cue) => {
          const localizedCue = {
            ...cue,
            textLocale: cue.textLocale ?? 'und',
            localizations: cue.localizations ?? [],
          };
          return cue.sourceIndex === sourceIndex ? { ...localizedCue, ...nextCue } : localizedCue;
        }),
      });
      setEditingCueSourceIndex(null);
      setDraftCueI18n(null);
    } catch {
      setSaveError(messages.videoDocuments.editor.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  function startCueEdit(cue: VideoDocumentTranscriptCue) {
    setEditingCueSourceIndex(cue.sourceIndex);
    setDraftCueI18n(transcriptCueI18nDraft(cue));
    setSaveError('');
  }

  function cancelCueEdit() {
    setEditingCueSourceIndex(null);
    setDraftCueI18n(null);
    setSaveError('');
  }

  function moveTranscriptViewport(timestampMs: number) {
    const targetCue =
      content!.cues.find(
        (cue) =>
          timestampMs >= cue.startTimestampMs && timestampMs <= Math.max(cue.endTimestampMs, cue.startTimestampMs),
      ) ??
      content!.cues.find((cue) => cue.startTimestampMs >= timestampMs) ??
      content!.cues.at(-1);
    if (targetCue) setPendingScrollSourceIndex(targetCue.sourceIndex);
    if (query) setQuery('');
  }

  return (
    <section ref={sectionRef} data-slot="video-document-transcript" data-revision-id={revision.id}>
      <TranscriptToolbar
        actions={editingCueSourceIndex === null ? toolbarActions : undefined}
        target={toolbarTarget ?? null}
        canEdit={Boolean(onSave) && editingCueSourceIndex === null && !saving}
        editing={editing}
        saving={saving}
        saveDisabled={saving || draftCueTexts.some((text) => !text.trim())}
        copied={copied}
        copyLabel={labels.copy}
        copiedLabel={labels.copied}
        editLabel={messages.videoDocuments.editor.edit}
        cancelLabel={messages.videoDocuments.editor.cancel}
        saveLabel={messages.videoDocuments.editor.save}
        savingLabel={messages.videoDocuments.editor.saving}
        onCopy={() => void copyTranscript()}
        onEdit={() => {
          cancelCueEdit();
          setEditing(true);
        }}
        onCancel={() => setEditing(false)}
        onSave={() => void saveTranscript()}
      />
      <TranscriptHeader
        content={content}
        editing={editing}
        query={query}
        visibleCueCount={visibleCues.length}
        selectedLanguage={selectedLanguage}
        displayMode={displayMode}
        onQueryChange={setQuery}
        onLanguageChange={selectLanguage}
        onDisplayModeChange={setDisplayMode}
        translating={translating}
        translationProgress={translationProgress}
        translationCancelling={translationCancelling}
        onTranslate={onTranslate}
        onCancelTranslation={onCancelTranslation}
      />
      {saveError && <p className="border-b py-3 text-sm text-destructive">{saveError}</p>}
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2 pt-4">
        <VideoDocumentTranscriptNavigator
          durationMs={timelineDurationMs}
          currentTimeMs={currentTimeMs}
          ariaLabel={suppliedLabels?.timeline}
          cues={content.cues}
          focusedCue={focusedCue}
          textFocusLabel={labels.textFocus}
          videoPositionLabel={labels.videoPosition}
          viewportRange={viewportRange}
          onMove={moveTranscriptViewport}
        />
        <TranscriptCueList
          cues={editing ? content.cues : visibleCues}
          editing={editing}
          activeCueSourceIndex={activeCueSourceIndex}
          focusedCueSourceIndex={focusedCueSourceIndex}
          cueIndexBySource={cueIndexBySource}
          draftCueTexts={draftCueTexts}
          editingCueSourceIndex={editingCueSourceIndex}
          draftCueI18n={draftCueI18n}
          saving={saving}
          canEdit={Boolean(onSave)}
          selectedLanguage={selectedLanguage}
          displayMode={displayMode}
          onCueRef={(sourceIndex, element) => {
            if (element) cueRefs.current.set(sourceIndex, element);
            else cueRefs.current.delete(sourceIndex);
          }}
          onFocusCue={setFocusedCueSourceIndex}
          onSeek={onSeek}
          onDraftCueTextChange={(cueIndex, text) =>
            setDraftCueTexts((current) => {
              const next = [...current];
              next[cueIndex] = text;
              return next;
            })
          }
          onDraftCueI18nChange={setDraftCueI18n}
          onSaveTranscript={() => void saveTranscript()}
          onSaveCue={(sourceIndex) => void saveCue(sourceIndex)}
          onStartCueEdit={startCueEdit}
          onCancelCueEdit={cancelCueEdit}
        />
      </div>
    </section>
  );
}
