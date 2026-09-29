import type { Editor } from '@tiptap/core';
import { useSyncExternalStore, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import {
  VideoDocumentWysiwygToolbar,
  type VideoDocumentWysiwygToolbarState,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import {
  VideoDocumentSearchReplace,
  type VideoDocumentSearchReplaceMode,
} from '@/renderer/features/video-documents/VideoDocumentSearchReplace';
import { articleEditorLocationAtPosition } from '@/renderer/features/video-documents/articleElementIdentity';
import type { VideoDocumentWysiwygEditorProps } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useActiveContentEditor } from '@/renderer/features/content-editor/ActiveContentEditor';
import { useEditorState } from '@tiptap/react';
import { selectToolbarState } from '@/renderer/features/content-editor/contentEditorToolbarState';

const noSubscription = () => () => undefined;
const noSnapshot = () => undefined;

export function VideoDocumentEditorChrome({
  referenceAction,
  onImageOperation,
  editor,
  props,
  searchReplaceMode,
  setSearchReplaceMode,
  state,
}: {
  referenceAction?: ReactNode;
  onImageOperation?(operation: Promise<void>): void;
  editor: Editor;
  props: VideoDocumentWysiwygEditorProps;
  searchReplaceMode: VideoDocumentSearchReplaceMode;
  setSearchReplaceMode: Dispatch<SetStateAction<VideoDocumentSearchReplaceMode>>;
  state: VideoDocumentWysiwygToolbarState;
}) {
  const { active } = useActiveContentEditor();
  const shared = active && !active.editor.isDestroyed ? active : null;
  const toolbarEditor = shared?.editor ?? editor;
  const sourceState = useSyncExternalStore(
    shared?.session.model.subscribe ?? noSubscription,
    shared?.session.model.getSnapshot ?? noSnapshot,
    shared?.session.model.getSnapshot ?? noSnapshot,
  );
  const sourceBindings = sourceState?.draft.metadata.mediaBindings.map((binding) => ({
    ...binding,
    kind: 'IMAGE' as const,
    timestampMs: null,
    endTimestampMs: null,
    posterAssetId: null,
  }));
  const sharedState = useEditorState({
    editor: toolbarEditor,
    selector: ({ editor: current }) => selectToolbarState(current),
  });
  return (
    <>
      <VideoDocumentWysiwygToolbar
        toolbarPreset={props.toolbarPreset}
        figureAssetIds={shared ? sourceBindings?.map((binding) => binding.assetId) : props.figureAssetIds}
        embedded={props.embedded}
        outlineMode={shared ? false : props.outlineMode}
        interactionsEnabled={props.contentSource?.kind === 'ARTICLE'}
        referenceAction={shared ? undefined : referenceAction}
        onImageOperation={shared ? shared.inputs.track : onImageOperation}
        importImage={props.importImage}
        editor={toolbarEditor}
        state={sharedState ?? state}
        labels={props.labels}
        documentId={shared ? undefined : props.documentId}
        sourceVideoUrl={props.sourceVideoUrl}
        currentTimeMs={props.currentTimeMs}
        durationMs={props.durationMs}
        timelineSegments={props.timelineSegments}
        mediaBindings={sourceBindings ?? props.mediaBindings}
        onFrameCaptured={shared ? undefined : props.onFrameCaptured}
        onImageImported={shared ? shared.session.imageImported : props.onImageImported}
        onImageImportError={props.onImageImportError}
        searchOpen={searchReplaceMode !== null}
        onSearchToggle={() => setSearchReplaceMode((current) => (current === null ? 'search' : null))}
        illustrationLabel={props.illustrationLabel}
        onIllustrationRequest={shared ? undefined : props.onIllustrationRequest}
        articleElementControls={shared ? undefined : props.articleElementControls}
      />
      <VideoDocumentSearchReplace
        editor={toolbarEditor}
        labels={props.labels}
        mode={searchReplaceMode}
        className={props.outlineMode ? 'top-0' : undefined}
        onModeChange={setSearchReplaceMode}
        onNavigate={(position) => {
          if (shared) return;
          const location = articleEditorLocationAtPosition(editor, position);
          if (location) props.onArticleNavigationLocation?.(location);
        }}
      />
    </>
  );
}
