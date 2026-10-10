import { useContext, type ComponentProps } from 'react';
import { FilesIcon, MessageSquareIcon } from 'lucide-react';
import { CreationOutputsPanel } from '@/renderer/components/creator/CreationOutputsPanel';
import { CreationWorkNavigationContext } from '@/renderer/components/creator/CreationWorkNavigation';
import type { ArticleEditorSidebarController } from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import { ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { ContentCommentsPanel } from '@/renderer/features/content-editor/ContentCommentsPanel';
import { useI18n } from '@/renderer/i18n/useI18n';

export function OutlineArticleSidebar({
  toggleHost,
  controller,
  comments,
}: {
  toggleHost?: HTMLElement | null;
  controller: ArticleEditorSidebarController;
  comments: ComponentProps<typeof ContentCommentsPanel>;
}) {
  const { messages } = useI18n();
  const navigation = useContext(CreationWorkNavigationContext);
  const active = navigation && controller.preferences.activePanel !== 'COMMENTS' ? 'OUTPUTS' : 'COMMENTS';
  return (
    <ContentWorkspacePanels
      toggleHost={toggleHost}
      keepMounted={active === 'OUTPUTS'}
      preferenceKey={controller.preferenceKey}
      panelWidth={controller.preferences.width}
      minimumWidth={controller.minimumWidth}
      maximumWidth={controller.maximumWidth}
      onPanelWidthChange={controller.setPanelWidth}
      maximized={controller.maximized}
      onMaximizedChange={controller.setMaximized}
      active={active}
      open={navigation ? controller.open : controller.panelOpen('COMMENTS')}
      onActiveChange={(id) => controller.showPanel(id === 'OUTPUTS' ? 'OUTPUTS' : 'COMMENTS')}
      onOpenChange={(open) => controller.setPanelOpen(active, open)}
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
          id: 'COMMENTS',
          icon: MessageSquareIcon,
          label: messages.contentEditor.comments,
          count: comments.comments.filter((comment) => comment.status === 'OPEN').length,
          content: <ContentCommentsPanel {...comments} />,
        },
      ]}
    />
  );
}
