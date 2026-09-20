import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/renderer/lib/utils';
import { ContentBlockHandle } from '@/renderer/features/content-editor/ContentBlockHandle';
import { OutlineScopeBar } from '@/renderer/features/content-editor/OutlineScopeBar';
import { OutlineAppendButton } from '@/renderer/features/content-editor/OutlineAppendButton';
import { OutlineSelectionToolbar } from '@/renderer/features/content-editor/OutlineSelectionToolbar';
import { ContentLinkPasteMenu } from '@/renderer/features/content-editor/ContentLinkPasteMenu';
import { ContentLinkContextMenu } from '@/renderer/features/content-editor/ContentLinkContextMenu';
import { ContentLinkSource } from '@/renderer/features/content-editor/ContentLinkProviders';
import { followContentBlockAnchor } from '@/renderer/features/content-editor/ContentDocumentOutline';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentReferenceHost, type ReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { OutlineGlobalCollapseRail } from '@/renderer/features/content-editor/OutlineGlobalCollapseRail';

export function VideoDocumentEditorSurfaces({
  missingNavigationTarget,
  embedded,
  contentSource,
  outlineMode,
  beforeReferenceCapture,
  onAddComment,
  onFigureReferenceClick,
  chrome,
  toolbarRoot,
  editor,
  editorRootRef,
  secondaryChromeRoot,
}: {
  missingNavigationTarget?: boolean;
  embedded?: boolean;
  contentSource?: import('@/shared/contracts/content-library').ContentSource;
  outlineMode?: boolean;
  beforeReferenceCapture?: ReferenceHost['beforeCapture'];
  onAddComment?: ReferenceHost['onAddComment'];
  onFigureReferenceClick?(assetId: string): void;
  chrome: ReactNode;
  toolbarRoot?: HTMLDivElement | null;
  editor: Editor;
  editorRootRef: RefObject<HTMLDivElement | null>;
  secondaryChromeRoot?: HTMLDivElement | null;
}) {
  const copy = useI18n().messages.referenceOutline;
  const [navigationError, setNavigationError] = useState('');
  return (
    <ContentReferenceHost.Provider
      value={{ source: contentSource, outline: outlineMode, beforeCapture: beforeReferenceCapture, onAddComment }}
    >
      <ContentLinkSource.Provider value={contentSource}>
        <div
          ref={editorRootRef}
          data-slot="video-document-wysiwyg-editor"
          data-content-source={contentSource ? JSON.stringify(contentSource) : undefined}
          className={cn(
            'group/editor relative min-w-0 w-full',
            outlineMode && 'min-h-[60vh]',
            embedded ? 'bg-transparent text-inherit' : 'border-y bg-surface focus-within:border-selected-border',
          )}
          onClickCapture={(event) => {
            const found = followContentBlockAnchor(editor, event);
            if (found !== undefined) setNavigationError(found ? '' : copy.locationMissing);
          }}
        >
          {(navigationError || missingNavigationTarget) && (
            <p role="alert" className="px-2 text-xs text-destructive">
              {navigationError || copy.locationMissing}
            </p>
          )}
          {toolbarRoot ? createPortal(chrome, toolbarRoot) : chrome}
          {outlineMode ? <OutlineScopeBar editor={editor} /> : null}
          <ContentBlockHandle
            editor={editor}
            rootRef={editorRootRef}
            source={contentSource}
            outlineMode={outlineMode}
          />
          <ContentLinkPasteMenu editor={editor} source={contentSource} />
          <div className="relative min-w-0">
            {outlineMode && <OutlineGlobalCollapseRail editor={editor} />}
            <ContentLinkContextMenu
              editor={editor}
              source={contentSource}
              onFigureReferenceClick={onFigureReferenceClick}
            >
              <EditorContent
                className="min-w-0 w-full [&>.ProseMirror]:min-w-0 [&>.ProseMirror]:w-full [&_.find-and-replace-result]:box-decoration-clone [&_.find-and-replace-result]:rounded-sm [&_.find-and-replace-result]:bg-warning-surface [&_.find-and-replace-result-current]:scroll-mt-24 [&_.find-and-replace-result-current]:ring-1 [&_.find-and-replace-result-current]:ring-inset [&_.find-and-replace-result-current]:ring-warning"
                editor={editor}
              />
            </ContentLinkContextMenu>
          </div>
          {outlineMode && <OutlineAppendButton editor={editor} />}
          {outlineMode && <OutlineSelectionToolbar editor={editor} />}
        </div>
        {secondaryChromeRoot
          ? createPortal(
              <>
                {chrome}
                {outlineMode && <OutlineSelectionToolbar editor={editor} />}
              </>,
              secondaryChromeRoot,
            )
          : null}
      </ContentLinkSource.Provider>
    </ContentReferenceHost.Provider>
  );
}
