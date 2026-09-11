import type { ArticleEditorSidebarPanel } from '@/renderer/components/creator/article-editor/articleEditorOutlinePreferences';
import type { ArticleEditorSidebarController } from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import { ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ReactNode } from 'react';

interface Props {
  commentCount: number;
  comments: ReactNode;
  controller: ArticleEditorSidebarController;
  files: ReactNode;
  fileCount: number;
  media: ReactNode;
  mediaCount: number;
  outline: ReactNode;
  outlineAvailable: boolean;
  zh: boolean;
}

export function ArticleEditorSidebar({
  controller,
  comments,
  commentCount,
  files,
  fileCount,
  media,
  mediaCount,
  outline,
  outlineAvailable,
}: Props) {
  const copy = useI18n().messages.contentEditor;
  return (
    <ContentWorkspacePanels
      preferenceKey={controller.preferenceKey}
      panelWidth={controller.getPanelWidth(controller.preferences.activePanel)}
      minimumWidth={controller.minimumWidth}
      maximumWidth={controller.maximumWidth}
      onPanelWidthChange={(width) => controller.setPanelWidth(controller.preferences.activePanel, width)}
      active={controller.preferences.activePanel}
      open={controller.open}
      onActiveChange={(id) => controller.showPanel(id as ArticleEditorSidebarPanel)}
      onOpenChange={controller.setExpanded}
      tabs={[
        { id: 'MEDIA', label: copy.media, count: mediaCount, content: media },
        { id: 'FILES', label: copy.files, count: fileCount, content: files },
        { id: 'COMMENTS', label: copy.comments, count: commentCount, content: comments },
        ...(outlineAvailable ? [{ id: 'OUTLINE', label: copy.outline, content: outline }] : []),
      ]}
    />
  );
}
