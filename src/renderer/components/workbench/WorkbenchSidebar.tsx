import type { ComponentProps, ReactNode } from 'react';
import {
  WorkbenchSidebarHeader,
  WorkbenchSidebarHeaderScope,
  sidebarRailWidth,
} from '@/renderer/components/workbench/WorkbenchSidebarHeader';
import { useWorkspaceSidebarWidth } from '@/renderer/components/workspace/WorkspaceHeader';
import { cn } from '@/renderer/lib/utils';

export function WorkbenchSidebar({
  expanded,
  wide,
  width,
  animate,
  label,
  toggle,
  header,
  children,
  resizeHandle,
  contentId,
  onContentFocus,
  ...props
}: Omit<ComponentProps<'aside'>, 'children'> & {
  expanded: boolean;
  wide: boolean;
  width: number;
  animate: boolean;
  label: string;
  toggle: ReactNode;
  /** Omit the header when null and its toggle is hosted elsewhere. */
  header?: ReactNode;
  children: ReactNode;
  resizeHandle: ReactNode;
  contentId: string;
  onContentFocus?: ComponentProps<'div'>['onFocusCapture'];
}) {
  // Hidden tabs retain their geometry and portal host; visibility only controls interaction.
  const resolvedWidth = useWorkspaceSidebarWidth(wide ? (expanded ? width : sidebarRailWidth) : 0, animate);
  return (
    <aside
      {...props}
      data-workspace-sidebar-body
      tabIndex={-1}
      aria-label={label}
      hidden={!wide && !expanded}
      inert={!wide && !expanded}
      className={cn(
        'relative min-h-0 min-w-0 shrink-0 border-r bg-surface-sunken outline-none',
        !wide && !expanded ? 'hidden' : 'flex flex-col',
        !wide && 'flex-1',
        animate &&
          !resolvedWidth.startsWith('var(') &&
          'motion-safe:transition-[width] duration-base ease-[var(--ease-standard)]',
        props.className,
      )}
      style={wide ? { width: resolvedWidth } : undefined}
    >
      {(toggle || header !== null) && (
        <WorkbenchSidebarHeaderScope value={{ toggle, expanded }}>
          <WorkbenchSidebarHeader>
            {header ?? <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>}
          </WorkbenchSidebarHeader>
        </WorkbenchSidebarHeaderScope>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          id={contentId}
          onFocusCapture={onContentFocus}
          inert={!expanded}
          aria-hidden={!expanded}
          className={cn(
            'flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
            animate && 'motion-safe:transition-[opacity,visibility] duration-fast',
            !expanded && 'invisible opacity-0',
          )}
          style={wide ? { width: Math.max(width - 1, 0) } : undefined}
        >
          {children}
        </div>
      </div>
      {resizeHandle}
    </aside>
  );
}
