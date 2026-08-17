import { LoaderCircleIcon, PencilIcon, PlusIcon, SaveIcon, SparklesIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  VideoDocumentMediaBinding,
  VideoDocumentFrameCaptureResult,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentRevisionMediaDto,
  VideoDocumentTimelineSegment,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { VideoDocumentAutosaveSettings } from '@/renderer/features/video-documents/VideoDocumentAutosaveSettings';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useVideoDocumentArticleMarkdown } from '@/renderer/features/video-documents/VideoDocumentArticleMarkdown';
import { VideoDocumentNoteListHoverCard } from '@/renderer/features/video-documents/VideoDocumentNoteListHoverCard';
import { VideoDocumentOutlineRail } from '@/renderer/features/video-documents/VideoDocumentOutlineRail';
import { VideoDocumentRevisionHistory } from '@/renderer/features/video-documents/VideoDocumentRevisionHistory';
import {
  VideoDocumentToolbar,
  VideoDocumentToolbarAction,
} from '@/renderer/features/video-documents/VideoDocumentToolbar';
import {
  VideoDocumentWysiwygEditor,
  type VideoDocumentEditorImageImport,
  type VideoDocumentQuickInsertNoteRequest,
  type VideoDocumentWysiwygEditorLabels,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import { useVideoDocumentArticleAutosave } from '@/renderer/features/video-documents/useVideoDocumentArticleAutosave';
import { useVideoDocumentArticleOutline } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';
import { useVideoDocumentRichNotes } from '@/renderer/features/video-documents/useVideoDocumentRichNotes';
import { videoDocumentArticleHasVisibleContent } from '@/renderer/features/video-documents/videoDocumentArticleContent';
import { cn } from '@/renderer/lib/utils';

interface Props {
  documentId?: string;
  documentTitle?: string;
  sourceVideoUrl?: string;
  revision: VideoDocumentRevisionDto;
  transcriptRevision?: VideoDocumentRevisionDto | null;
  toolbarActions?: ReactNode;
  toolbarTarget?: HTMLElement | null;
  onSave?(content: VideoDocumentRevisionContent): Promise<void>;
  generating?: boolean;
  generationDisabled?: boolean;
  onGenerate?(noteId?: string | null): void;
  currentTimeMs?: number;
  durationMs?: number;
  quickInsertNoteRequest?: VideoDocumentQuickInsertNoteRequest | null;
  activeNoteId?: string | null;
  onEditingChange?(editing: boolean): void;
  onQuickInsertNoteBusyChange?(busy: boolean): void;
  onActiveNoteChange?(noteId: string): void;
  onOpenTranscript?(timestampMs: number): void;
  onSeek(timestampMs: number): void;
}

interface ArticleEditorToolbarProps {
  actions?: ReactNode;
  persistentActions?: ReactNode;
  target: HTMLElement | null;
  editing: boolean;
  saving: boolean;
  saveDisabled: boolean;
  canEdit: boolean;
  editLabel: string;
  cancelLabel: string;
  saveLabel: string;
  savingLabel: string;
  onEdit(): void;
  onCancel(): void;
  onSave(): void;
}

function ArticleEditorToolbar({
  actions,
  persistentActions,
  target,
  editing,
  saving,
  saveDisabled,
  canEdit,
  editLabel,
  cancelLabel,
  saveLabel,
  savingLabel,
  onEdit,
  onCancel,
  onSave,
}: ArticleEditorToolbarProps) {
  return (
    <VideoDocumentToolbar target={target}>
      {!editing && actions}
      {persistentActions}
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

interface ArticleBodyProps {
  editing: boolean;
  blank: boolean;
  editable: boolean;
  editDisabled: boolean;
  generating: boolean;
  generationDisabled: boolean;
  markdown: string;
  draftMarkdown: string;
  saveError: string;
  articleTextLabel: string;
  editLabel: string;
  generateLabel: string;
  generatingLabel: string;
  richTextLabels: VideoDocumentWysiwygEditorLabels;
  mediaBindings: readonly VideoDocumentMediaBinding[];
  media: readonly VideoDocumentRevisionMediaDto[];
  documentId?: string;
  sourceVideoUrl?: string;
  currentTimeMs: number;
  durationMs: number;
  timelineSegments: readonly VideoDocumentTimelineSegment[];
  quickInsertNoteRequest?: VideoDocumentQuickInsertNoteRequest | null;
  components: Components;
  onDraftChange(value: string): void;
  onFrameCaptured(result: VideoDocumentFrameCaptureResult): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageImportError(): void;
  onQuickInsertNoteBusyChange?(busy: boolean): void;
  onQuickInsertNoteError(): void;
  onEdit(): void;
  onGenerate?(): void;
  onSave(markdown?: string): void;
}

type ArticleGenerationLabels = ReturnType<typeof useI18n>['messages']['videoDocuments']['generation'];

function articleInteractionState(input: {
  canSave: boolean;
  generating: boolean;
  generationDisabled: boolean;
  saving: boolean;
  mutating: boolean;
}) {
  const mutationBusy = input.saving || input.mutating;
  return {
    canEdit: input.canSave && !input.generating && !mutationBusy,
    generationDisabled: input.generating || input.generationDisabled || mutationBusy,
  };
}

function ArticleGenerationToolbarAction({
  generating,
  disabled,
  hasVisibleContent,
  labels,
  onGenerate,
}: {
  generating: boolean;
  disabled: boolean;
  hasVisibleContent: boolean;
  labels: ArticleGenerationLabels;
  onGenerate?: () => void;
}) {
  if (!onGenerate) return null;
  return (
    <VideoDocumentToolbarAction
      type="button"
      disabled={disabled}
      expanded={generating}
      icon={generating ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
      label={generating ? labels.generating : hasVisibleContent ? labels.regenerate : labels.generate}
      onClick={onGenerate}
    />
  );
}

const ArticleMarkdown = memo(function ArticleMarkdown({
  markdown,
  components,
}: {
  markdown: string;
  components: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml urlTransform={defaultUrlTransform}>
      {markdown}
    </ReactMarkdown>
  );
});

function ArticleBlankActions({
  editable,
  editDisabled,
  generating,
  generationDisabled,
  editLabel,
  generateLabel,
  generatingLabel,
  onEdit,
  onGenerate,
}: Pick<
  ArticleBodyProps,
  | 'editable'
  | 'editDisabled'
  | 'generating'
  | 'generationDisabled'
  | 'editLabel'
  | 'generateLabel'
  | 'generatingLabel'
  | 'onEdit'
  | 'onGenerate'
>) {
  return (
    <div className="grid min-h-[60vh] place-items-center border-y">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {editable && (
          <Button type="button" variant="outline" disabled={editDisabled} onClick={onEdit}>
            <PencilIcon className="size-4" />
            {editLabel}
          </Button>
        )}
        {onGenerate && (
          <Button type="button" disabled={generationDisabled} onClick={onGenerate}>
            {generating ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
            {generating ? generatingLabel : generateLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function ArticleBody({
  editing,
  blank,
  editable,
  editDisabled,
  generating,
  generationDisabled,
  markdown,
  draftMarkdown,
  saveError,
  articleTextLabel,
  editLabel,
  generateLabel,
  generatingLabel,
  richTextLabels,
  mediaBindings,
  media,
  documentId,
  sourceVideoUrl,
  currentTimeMs = 0,
  durationMs = 0,
  timelineSegments,
  quickInsertNoteRequest,
  components,
  onDraftChange,
  onFrameCaptured,
  onImageImported,
  onImageImportError,
  onQuickInsertNoteBusyChange,
  onQuickInsertNoteError,
  onEdit,
  onGenerate,
  onSave,
}: ArticleBodyProps) {
  return (
    <>
      {saveError && <p className="mb-3 text-sm text-destructive">{saveError}</p>}
      {editing ? (
        <VideoDocumentWysiwygEditor
          markdown={draftMarkdown}
          mediaBindings={mediaBindings}
          media={media}
          documentId={documentId}
          sourceVideoUrl={sourceVideoUrl}
          currentTimeMs={currentTimeMs}
          durationMs={durationMs}
          timelineSegments={timelineSegments}
          quickInsertNoteRequest={quickInsertNoteRequest}
          ariaLabel={articleTextLabel}
          labels={richTextLabels}
          onChange={onDraftChange}
          onFrameCaptured={onFrameCaptured}
          onImageImported={onImageImported}
          onImageImportError={onImageImportError}
          onQuickInsertNoteBusyChange={onQuickInsertNoteBusyChange}
          onQuickInsertNoteError={onQuickInsertNoteError}
          onSave={onSave}
        />
      ) : blank ? (
        <ArticleBlankActions
          editable={editable}
          editDisabled={editDisabled}
          generating={generating}
          generationDisabled={generationDisabled}
          editLabel={editLabel}
          generateLabel={generateLabel}
          generatingLabel={generatingLabel}
          onEdit={onEdit}
          onGenerate={onGenerate}
        />
      ) : (
        <ArticleMarkdown markdown={markdown} components={components} />
      )}
    </>
  );
}

export function VideoDocumentArticle({
  documentId,
  documentTitle,
  sourceVideoUrl,
  revision,
  transcriptRevision,
  toolbarActions,
  toolbarTarget,
  onSave,
  generating = false,
  generationDisabled = false,
  onGenerate,
  currentTimeMs = 0,
  durationMs = 0,
  quickInsertNoteRequest,
  activeNoteId,
  onEditingChange,
  onQuickInsertNoteBusyChange,
  onActiveNoteChange,
  onOpenTranscript,
  onSeek,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.article;
  const editorLabels = messages.videoDocuments.editor;
  const generationLabels = messages.videoDocuments.generation;
  const resolvedDocumentTitle = documentTitle || revision.id;
  const noteWorkspace = useVideoDocumentRichNotes({
    revision,
    documentTitle: resolvedDocumentTitle,
    activeNoteId,
    untitledLabel: labels.notes.untitled,
    onActiveNoteChange,
    onSave,
  });
  const { content, notes, selectedNoteId } = noteWorkspace;
  const articleEditor = useVideoDocumentArticleAutosave({
    revision,
    content,
    selectedNoteId,
    generating,
    mutating: noteWorkspace.mutating,
    saveFailedLabel: editorLabels.saveFailed,
    autoSaveFailedLabel: editorLabels.autoSave.failed,
    onSave,
    onEditingChange,
    contentForCurrentNote: noteWorkspace.contentForCurrentNote,
  });
  const {
    editing,
    draftMarkdown,
    draftMediaBindings,
    draftMedia,
    saving,
    saveError,
    autoSavePreferences,
    autoSaveStatus,
    setAutoSavePreferences,
    setDraftMediaBindings,
    setDraftMedia,
    setSaveError,
  } = articleEditor;
  const { articleRef, outlineItems, activeOutlineId, headingIdForNode, selectOutlineItem } =
    useVideoDocumentArticleOutline({
      markdown: content?.markdown ?? '',
      draftMarkdown,
      editing,
    });

  const components = useVideoDocumentArticleMarkdown({
    content,
    media: revision.media,
    transcriptRevision,
    labels,
    headingIdForNode,
    onOpenTranscript,
    onSeek,
  });

  if (!content) return null;
  const selectedContent = content;
  const hasVisibleContent = videoDocumentArticleHasVisibleContent(selectedContent.markdown);
  const interactionState = articleInteractionState({
    canSave: Boolean(onSave),
    generating,
    generationDisabled,
    saving,
    mutating: noteWorkspace.mutating,
  });

  function generateCurrentNote() {
    onGenerate?.(noteWorkspace.collection ? selectedNoteId : null);
  }
  const generateAction = onGenerate ? generateCurrentNote : undefined;

  function startEditing() {
    if (!interactionState.canEdit) return;
    articleEditor.startEditing();
  }

  const persistentToolbarActions = (
    <>
      {onSave && (
        <VideoDocumentAutosaveSettings
          preferences={autoSavePreferences}
          status={autoSaveStatus}
          onChange={setAutoSavePreferences}
        />
      )}
      <VideoDocumentRevisionHistory revision={revision} />
    </>
  );

  const combinedToolbarActions = (
    <>
      <VideoDocumentNoteListHoverCard
        notes={notes}
        activeNoteId={selectedNoteId}
        label={labels.notes.all}
        renameLabel={labels.notes.rename}
        disabled={editing || saving || generating}
        onSelect={(noteId) => onActiveNoteChange?.(noteId)}
        onRename={async (noteId, title) => {
          setSaveError('');
          try {
            await noteWorkspace.renameNote(noteId, title);
          } catch {
            setSaveError(editorLabels.saveFailed);
            throw new Error('VIDEO_DOCUMENT_NOTE_RENAME_FAILED');
          }
        }}
      />
      <VideoDocumentToolbarAction
        type="button"
        disabled={editing || saving || generating || noteWorkspace.mutating}
        icon={
          noteWorkspace.mutating ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <PlusIcon className="size-4" />
          )
        }
        label={labels.notes.newNote}
        onClick={() => {
          setSaveError('');
          void noteWorkspace.createNote().catch(() => setSaveError(editorLabels.saveFailed));
        }}
      />
      <ArticleGenerationToolbarAction
        generating={generating}
        disabled={interactionState.generationDisabled}
        hasVisibleContent={hasVisibleContent}
        labels={generationLabels}
        onGenerate={generateAction}
      />
      {toolbarActions}
    </>
  );
  const outlineVisible = outlineItems.length > 0;

  return (
    <article ref={articleRef} data-slot="video-document-article" data-revision-id={revision.id} className="min-w-0">
      <div className={cn(outlineVisible && 'grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2')}>
        {outlineVisible && (
          <VideoDocumentOutlineRail
            items={outlineItems}
            activeId={activeOutlineId}
            ariaLabel={labels.outline}
            onSelect={selectOutlineItem}
          />
        )}
        <div className="min-w-0">
          <ArticleEditorToolbar
            actions={combinedToolbarActions}
            persistentActions={persistentToolbarActions}
            target={toolbarTarget ?? null}
            editing={editing}
            saving={saving}
            saveDisabled={saving || generating || !draftMarkdown.trim()}
            canEdit={interactionState.canEdit}
            editLabel={editorLabels.edit}
            cancelLabel={editorLabels.cancel}
            saveLabel={editorLabels.save}
            savingLabel={editorLabels.saving}
            onEdit={startEditing}
            onCancel={articleEditor.cancelEditing}
            onSave={() => void articleEditor.save()}
          />
          <ArticleBody
            editing={editing}
            blank={!hasVisibleContent}
            editable={Boolean(onSave)}
            editDisabled={!interactionState.canEdit}
            generating={generating}
            generationDisabled={interactionState.generationDisabled}
            markdown={content.markdown}
            draftMarkdown={draftMarkdown}
            saveError={saveError}
            articleTextLabel={editorLabels.articleText}
            editLabel={editorLabels.edit}
            generateLabel={generationLabels.generate}
            generatingLabel={generationLabels.generating}
            richTextLabels={editorLabels.richText}
            mediaBindings={draftMediaBindings}
            media={draftMedia}
            documentId={documentId}
            sourceVideoUrl={sourceVideoUrl}
            currentTimeMs={currentTimeMs}
            durationMs={durationMs}
            timelineSegments={content.timelineSegments ?? []}
            quickInsertNoteRequest={quickInsertNoteRequest}
            components={components}
            onDraftChange={articleEditor.changeDraftMarkdown}
            onFrameCaptured={(result) => {
              setDraftMediaBindings((current) => [
                ...current.filter((binding) => binding.path !== result.binding.path),
                result.binding,
              ]);
              setDraftMedia((current) => [
                ...current.filter((media) => media.assetId !== result.media.assetId),
                result.media,
              ]);
            }}
            onImageImported={({ binding, media }) => {
              setDraftMediaBindings((current) => [
                ...current.filter((candidate) => candidate.path !== binding.path),
                binding,
              ]);
              setDraftMedia((current) => [
                ...current.filter((candidate) => candidate.assetId !== media.assetId),
                media,
              ]);
            }}
            onImageImportError={() => setSaveError(editorLabels.richText.uploadImageFailed)}
            onQuickInsertNoteBusyChange={onQuickInsertNoteBusyChange}
            onQuickInsertNoteError={() => setSaveError(editorLabels.richText.captureFrameFailed)}
            onEdit={startEditing}
            onGenerate={generateAction}
            onSave={(markdown) => void articleEditor.save(markdown)}
          />
        </div>
      </div>
    </article>
  );
}
