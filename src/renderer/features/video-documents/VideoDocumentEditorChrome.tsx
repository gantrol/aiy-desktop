import type { Editor } from '@tiptap/core';
import type { Dispatch, SetStateAction } from 'react';
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

export function VideoDocumentEditorChrome({
  editor,
  props,
  searchReplaceMode,
  setSearchReplaceMode,
  state,
}: {
  editor: Editor;
  props: VideoDocumentWysiwygEditorProps;
  searchReplaceMode: VideoDocumentSearchReplaceMode;
  setSearchReplaceMode: Dispatch<SetStateAction<VideoDocumentSearchReplaceMode>>;
  state: VideoDocumentWysiwygToolbarState;
}) {
  return (
    <>
      <VideoDocumentWysiwygToolbar
        editor={editor}
        state={state}
        labels={props.labels}
        documentId={props.documentId}
        sourceVideoUrl={props.sourceVideoUrl}
        currentTimeMs={props.currentTimeMs}
        durationMs={props.durationMs}
        timelineSegments={props.timelineSegments}
        mediaBindings={props.mediaBindings}
        onFrameCaptured={props.onFrameCaptured}
        onImageImported={props.onImageImported}
        onImageImportError={props.onImageImportError}
        searchOpen={searchReplaceMode !== null}
        onSearchToggle={() => setSearchReplaceMode((current) => (current === null ? 'search' : null))}
        illustrationLabel={props.illustrationLabel}
        onIllustrationRequest={props.onIllustrationRequest}
        articleElementControls={props.articleElementControls}
      />
      <VideoDocumentSearchReplace
        editor={editor}
        labels={props.labels}
        mode={searchReplaceMode}
        onModeChange={setSearchReplaceMode}
        onNavigate={(position) => {
          const location = articleEditorLocationAtPosition(editor, position);
          if (location) props.onArticleNavigationLocation?.(location);
        }}
      />
    </>
  );
}
