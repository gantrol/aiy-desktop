import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { PanelsTopLeftIcon, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { TabDragView } from '@/renderer/components/workspace/workspace-tab-drag-session';
import { cn } from '@/renderer/lib/utils';

interface Props {
  view: TabDragView;
  title: string;
  icon?: LucideIcon;
  ghost: RefObject<HTMLDivElement | null>;
  indicator: RefObject<HTMLDivElement | null>;
}

export function WorkspaceTabDragLayer({ view, title, icon, ghost, indicator }: Props) {
  const { messages } = useI18n();
  const Icon = icon ?? PanelsTopLeftIcon;
  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-drag select-none">
      <div ref={indicator} className="fixed hidden rounded-none bg-foreground" />
      <div
        ref={ghost}
        className="fixed flex items-center gap-2 rounded-sm border border-border bg-background px-3 text-sm text-foreground shadow-overlay"
        style={{
          left: view.rect.left,
          top: view.rect.top,
          width: view.rect.width,
          height: view.rect.height,
          paddingLeft: view.iconOnly ? 9 : view.verticalLabel ? 4 : 12,
          paddingRight: view.iconOnly ? 9 : view.verticalLabel ? 4 : 12,
          paddingTop: view.verticalLabel ? 8 : 0,
          paddingBottom: view.verticalLabel ? 8 : 0,
          flexDirection: view.verticalLabel ? 'column' : 'row',
          gap: view.iconOnly ? 0 : 8,
        }}
      >
        <Icon className="size-3.5 shrink-0" />
        <span
          data-tab-drag-label=""
          className={cn('min-h-0 min-w-0 flex-1 truncate', view.verticalLabel && '[writing-mode:vertical-rl]')}
          style={{ opacity: view.iconOnly ? 0 : 1 }}
        >
          {title}
        </span>
        {view.phase === 'drag' && view.targetPinned !== null && (
          <span className="absolute left-0 top-full mt-1 whitespace-nowrap rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {view.targetPinned ? messages.app.workspace.pinTab : messages.app.workspace.unpinTab}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
