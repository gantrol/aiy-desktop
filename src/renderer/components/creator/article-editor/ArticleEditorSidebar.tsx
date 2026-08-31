import {
  ListTreeIcon,
  Maximize2Icon,
  MessageSquareIcon,
  Minimize2Icon,
  PanelLeftCloseIcon,
  PanelRightCloseIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import type { ArticleEditorSidebarPanel } from '@/renderer/components/creator/article-editor/articleEditorOutlinePreferences';
import { ArticleEditorPaneToolbar } from '@/renderer/components/creator/article-editor/ArticleEditorPane';
import type {
  ArticleEditorSidebarController,
  ArticleEditorSidebarMode,
} from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

interface Props {
  commentCount: number;
  comments: ReactNode;
  controller: ArticleEditorSidebarController;
  outline: ReactNode;
  outlineAvailable: boolean;
  zh: boolean;
}

function panelLabel(panel: ArticleEditorSidebarPanel, zh: boolean) {
  if (panel === 'OUTLINE') return zh ? '目录' : 'Outline';
  return zh ? '评论' : 'Comments';
}

function SidebarTabs({
  active,
  commentCount,
  outlineAvailable,
  zh,
  onPanelChange,
}: {
  active: ArticleEditorSidebarPanel;
  commentCount: number;
  outlineAvailable: boolean;
  zh: boolean;
  onPanelChange(panel: ArticleEditorSidebarPanel): void;
}) {
  return (
    <div className="flex min-w-0 flex-1 self-stretch">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-11 gap-1.5 rounded-none border-b-2 border-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-transparent',
          active === 'OUTLINE' && 'border-selected-foreground font-semibold text-foreground',
        )}
        disabled={!outlineAvailable}
        aria-pressed={active === 'OUTLINE'}
        onClick={() => onPanelChange('OUTLINE')}
      >
        <ListTreeIcon className="size-3.5" />
        {panelLabel('OUTLINE', zh)}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-11 gap-1.5 rounded-none border-b-2 border-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-transparent',
          active === 'COMMENTS' && 'border-selected-foreground font-semibold text-foreground',
        )}
        aria-pressed={active === 'COMMENTS'}
        onClick={() => onPanelChange('COMMENTS')}
      >
        <MessageSquareIcon className="size-3.5" />
        {panelLabel('COMMENTS', zh)}
        {commentCount > 0 && <span className="tabular-nums text-muted-foreground">{commentCount}</span>}
      </Button>
    </div>
  );
}

function SidebarHeader({
  active,
  commentCount,
  mode,
  outlineAvailable,
  side,
  zh,
  onClose,
  onPanelChange,
}: {
  active: ArticleEditorSidebarPanel;
  commentCount: number;
  mode: ArticleEditorSidebarMode;
  outlineAvailable: boolean;
  side: 'LEFT' | 'RIGHT';
  zh: boolean;
  onClose(): void;
  onPanelChange(panel: ArticleEditorSidebarPanel): void;
}) {
  const Icon = active === 'OUTLINE' ? ListTreeIcon : MessageSquareIcon;
  const CloseIcon = side === 'LEFT' ? PanelLeftCloseIcon : PanelRightCloseIcon;
  return (
    <div className="flex h-11 shrink-0 items-center border-b px-2">
      {mode === 'DUAL' ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-xs font-semibold">
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="truncate">{panelLabel(active, zh)}</span>
          {active === 'COMMENTS' && commentCount > 0 && (
            <span className="tabular-nums text-muted-foreground">{commentCount}</span>
          )}
        </div>
      ) : (
        <SidebarTabs
          active={active}
          commentCount={commentCount}
          outlineAvailable={outlineAvailable}
          zh={zh}
          onPanelChange={onPanelChange}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={zh ? '收起侧栏' : 'Collapse sidebar'}
        title={zh ? '收起侧栏' : 'Collapse sidebar'}
        onClick={onClose}
      >
        <CloseIcon className="size-4" />
      </Button>
    </div>
  );
}

function DockedSidebar({
  active,
  commentCount,
  content,
  controller,
  mode,
  outlineAvailable,
  side,
  zh,
}: {
  active: ArticleEditorSidebarPanel;
  commentCount: number;
  content: ReactNode;
  controller: ArticleEditorSidebarController;
  mode: ArticleEditorSidebarMode;
  outlineAvailable: boolean;
  side: 'LEFT' | 'RIGHT';
  zh: boolean;
}) {
  const width = controller.getPanelWidth(active);
  const edge = side === 'LEFT' ? 'right' : 'left';
  return (
    <aside
      className={cn(
        'relative flex shrink-0 flex-col bg-background',
        side === 'LEFT' ? 'order-first border-r' : 'order-last border-l',
      )}
      style={{ width }}
      aria-label={panelLabel(active, zh)}
    >
      <CreatorPaneResizeHandle
        edge={edge}
        label={zh ? '调整侧栏宽度' : 'Resize sidebar'}
        value={width}
        min={controller.minimumWidth}
        max={controller.maximumWidth}
        valueText={`${width}px`}
        onPointerDown={(event) => controller.beginResize(active, side === 'LEFT' ? 'RIGHT' : 'LEFT', event)}
        onValueChange={(value) => controller.setPanelWidth(active, value)}
      />
      <SidebarHeader
        active={active}
        commentCount={commentCount}
        mode={mode}
        outlineAvailable={outlineAvailable}
        side={side}
        zh={zh}
        onClose={() => controller.setPanelOpen(active, false)}
        onPanelChange={controller.showPanel}
      />
      <div className="flex min-h-0 flex-1 flex-col">{content}</div>
    </aside>
  );
}

function OverlaySidebar({
  active,
  commentCount,
  content,
  controller,
  outlineAvailable,
  zh,
}: Omit<Parameters<typeof DockedSidebar>[0], 'mode' | 'side'>) {
  return (
    <aside
      className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[calc(100%-3rem)] flex-col border-l bg-overlay shadow-overlay"
      aria-label={panelLabel(active, zh)}
    >
      <SidebarHeader
        active={active}
        commentCount={commentCount}
        mode="OVERLAY"
        outlineAvailable={outlineAvailable}
        side="RIGHT"
        zh={zh}
        onClose={() => controller.setPanelOpen(active, false)}
        onPanelChange={controller.showPanel}
      />
      <div className="flex min-h-0 flex-1 flex-col">{content}</div>
    </aside>
  );
}

export function ArticleEditorLayoutToolbar({
  commentCount,
  controller,
  outlineAvailable,
  zh,
  onClose,
}: Pick<Props, 'commentCount' | 'controller' | 'outlineAvailable' | 'zh'> & { onClose?(): void }) {
  const outlineOpen = controller.panelOpen('OUTLINE');
  const commentsOpen = controller.panelOpen('COMMENTS');
  const wide = controller.preferences.documentWidth === 'WIDE';
  const widthLabel = wide ? (zh ? '切换到标准宽度' : 'Use standard width') : zh ? '切换到宽屏宽度' : 'Use wide width';
  return (
    <ArticleEditorPaneToolbar>
      <div className="flex-1" />
      <Button
        type="button"
        variant={wide ? 'secondary' : 'ghost'}
        size="icon-sm"
        aria-label={widthLabel}
        aria-pressed={wide}
        title={widthLabel}
        onClick={() => controller.setDocumentWidth(wide ? 'STANDARD' : 'WIDE')}
      >
        {wide ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
      </Button>
      <Button
        type="button"
        variant={outlineOpen ? 'secondary' : 'ghost'}
        size="icon-sm"
        disabled={!outlineAvailable}
        aria-label={outlineOpen ? (zh ? '收起目录' : 'Close outline') : zh ? '打开目录' : 'Open outline'}
        aria-pressed={outlineOpen}
        title={outlineOpen ? (zh ? '收起目录' : 'Close outline') : zh ? '打开目录' : 'Open outline'}
        onClick={() => controller.togglePanel('OUTLINE')}
      >
        <ListTreeIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant={commentsOpen ? 'secondary' : 'ghost'}
        size="icon-sm"
        className="gap-1 px-2"
        aria-label={commentsOpen ? (zh ? '收起评论' : 'Close comments') : zh ? '打开评论' : 'Open comments'}
        aria-pressed={commentsOpen}
        title={commentsOpen ? (zh ? '收起评论' : 'Close comments') : zh ? '打开评论' : 'Open comments'}
        onClick={() => controller.togglePanel('COMMENTS')}
      >
        <MessageSquareIcon className="size-4" />
        {commentCount > 0 && <span className="text-2xs tabular-nums">{commentCount}</span>}
      </Button>
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={zh ? '关闭此分屏' : 'Close this pane'}
          title={zh ? '关闭此分屏' : 'Close this pane'}
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      )}
    </ArticleEditorPaneToolbar>
  );
}

export function ArticleEditorSidebar({ commentCount, comments, controller, outline, outlineAvailable, zh }: Props) {
  const active = outlineAvailable ? controller.preferences.activePanel : 'COMMENTS';

  useEffect(() => {
    if (!outlineAvailable && controller.preferences.activePanel === 'OUTLINE') controller.setActivePanel('COMMENTS');
  }, [controller, outlineAvailable]);

  if (controller.mode === 'DUAL') {
    return (
      <>
        {outlineAvailable && controller.panelOpen('OUTLINE') && (
          <DockedSidebar
            active="OUTLINE"
            commentCount={commentCount}
            content={outline}
            controller={controller}
            mode="DUAL"
            outlineAvailable={outlineAvailable}
            side="RIGHT"
            zh={zh}
          />
        )}
        {controller.panelOpen('COMMENTS') && (
          <DockedSidebar
            active="COMMENTS"
            commentCount={commentCount}
            content={comments}
            controller={controller}
            mode="DUAL"
            outlineAvailable={outlineAvailable}
            side="RIGHT"
            zh={zh}
          />
        )}
      </>
    );
  }

  if (!controller.panelOpen(active)) return null;
  const content = active === 'OUTLINE' ? outline : comments;
  if (controller.mode === 'OVERLAY') {
    return (
      <OverlaySidebar
        active={active}
        commentCount={commentCount}
        content={content}
        controller={controller}
        outlineAvailable={outlineAvailable}
        zh={zh}
      />
    );
  }
  return (
    <DockedSidebar
      active={active}
      commentCount={commentCount}
      content={content}
      controller={controller}
      mode="SINGLE"
      outlineAvailable={outlineAvailable}
      side="RIGHT"
      zh={zh}
    />
  );
}
