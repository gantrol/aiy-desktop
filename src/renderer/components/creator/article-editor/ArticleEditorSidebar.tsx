import type { ArticleEditorSidebarPanel } from '@/renderer/components/creator/article-editor/articleEditorOutlinePreferences';
import { ArticleEditorPaneToolbar } from '@/renderer/components/creator/article-editor/ArticleEditorPane';
import type { ArticleEditorSidebarController } from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import { Button } from '@/renderer/components/ui/button';
import { ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  commentCount: number;
  comments: ReactNode;
  controller: ArticleEditorSidebarController;
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
  media,
  mediaCount,
  outline,
  outlineAvailable,
}: Props) {
  const copy = useI18n().messages.contentEditor;
  return (
    <ContentWorkspacePanels
      active={controller.preferences.activePanel}
      open={controller.open}
      onActiveChange={(id) => controller.showPanel(id as ArticleEditorSidebarPanel)}
      onOpenChange={controller.setExpanded}
      tabs={[
        { id: 'MEDIA', label: copy.media, count: mediaCount, content: media },
        { id: 'COMMENTS', label: copy.comments, count: commentCount, content: comments },
        ...(outlineAvailable ? [{ id: 'OUTLINE', label: copy.outline, content: outline }] : []),
      ]}
    />
  );
}

export function ArticleEditorLayoutToolbar({
  controller,
  onClose,
}: Pick<Props, 'controller' | 'commentCount' | 'outlineAvailable' | 'zh'> & { onClose?(): void }) {
  const copy = useI18n().messages.contentEditor;
  const wide = controller.preferences.documentWidth === 'WIDE';
  return (
    <ArticleEditorPaneToolbar>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={wide ? copy.standardWidth : copy.wideWidth}
        title={wide ? copy.standardWidth : copy.wideWidth}
        onClick={() => controller.setDocumentWidth(wide ? 'STANDARD' : 'WIDE')}
      >
        {wide ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
      </Button>
      {onClose && (
        <Button variant="ghost" size="icon-sm" aria-label={copy.closePane} title={copy.closePane} onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      )}
    </ArticleEditorPaneToolbar>
  );
}
