import type { ArticleEditorSidebarPanel } from '@/renderer/components/creator/article-editor/articleEditorOutlinePreferences';
import type { ArticleEditorSidebarController } from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import { ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { CreationOutputsPanel } from '@/renderer/components/creator/CreationOutputsPanel';
import { CreationWorkNavigationContext } from '@/renderer/components/creator/CreationWorkNavigation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { FilesIcon, ImagesIcon, ListTreeIcon, MessageSquareIcon, PaperclipIcon } from 'lucide-react';
import { useContext, type ReactNode } from 'react';

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
  const { messages } = useI18n();
  const copy = messages.contentEditor;
  const navigation = useContext(CreationWorkNavigationContext);
  return (
    <ContentWorkspacePanels
      preferenceKey={controller.preferenceKey}
      panelWidth={controller.preferences.width}
      minimumWidth={controller.minimumWidth}
      maximumWidth={controller.maximumWidth}
      onPanelWidthChange={controller.setPanelWidth}
      active={
        !navigation && controller.preferences.activePanel === 'OUTPUTS' ? 'OUTLINE' : controller.preferences.activePanel
      }
      open={controller.open}
      maximized={controller.maximized}
      onMaximizedChange={controller.setMaximized}
      onActiveChange={(id) => controller.showPanel(id as ArticleEditorSidebarPanel)}
      onOpenChange={controller.setExpanded}
      tabs={[
        ...(navigation
          ? [
              {
                id: 'OUTPUTS',
                icon: FilesIcon,
                label: messages.creator.outputs.title,
                content: <CreationOutputsPanel />,
              },
            ]
          : []),
        {
          id: 'OUTLINE',
          icon: ListTreeIcon,
          label: copy.tableOfContents,
          content: outlineAvailable ? (
            outline
          ) : (
            <div role="status" className="px-2 py-3 text-xs text-muted-foreground">
              {copy.noHeadings}
            </div>
          ),
        },
        { id: 'MEDIA', icon: ImagesIcon, label: copy.media, count: mediaCount, content: media },
        { id: 'FILES', icon: PaperclipIcon, label: copy.files, count: fileCount, content: files },
        {
          id: 'COMMENTS',
          icon: MessageSquareIcon,
          label: copy.comments,
          count: commentCount,
          content: comments,
        },
      ]}
    />
  );
}
