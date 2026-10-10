import type { ComponentProps, ReactNode } from 'react';
import { CreationNewButton } from '@/renderer/components/creator/CreationNewButton';
import { CreationLibraryToolbar } from '@/renderer/components/creator/CreationLibraryToolbar';
import { CreationLibraryFilterMenu } from '@/renderer/components/creator/CreationLibraryFilterMenu';
import {
  WorkbenchSidebarHeader,
  WorkbenchSidebarHeaderScope,
} from '@/renderer/components/workbench/WorkbenchSidebarHeader';

interface Props extends ComponentProps<typeof CreationLibraryToolbar> {
  collapsed: boolean;
  busy: boolean;
  paneToggle: ReactNode;
  collapsedSearch: ReactNode;
  onNewCreation: ComponentProps<typeof CreationNewButton>['onNewCreation'];
  onNewAnimation?: ComponentProps<typeof CreationNewButton>['onNewAnimation'];
  onNewAlbum(): void;
  newAlbumLabel?: string;
}

export function CreationLibraryHeader({
  collapsed,
  busy,
  paneToggle,
  collapsedSearch,
  onNewCreation,
  onNewAnimation,
  onNewAlbum,
  newAlbumLabel,
  ...toolbar
}: Props) {
  const creationActions = (
    <CreationNewButton
      busy={busy}
      collapsed={collapsed}
      newAlbumLabel={newAlbumLabel}
      onNewCreation={onNewCreation}
      onNewAnimation={onNewAnimation}
      onNewAlbum={onNewAlbum}
    />
  );

  return (
    <WorkbenchSidebarHeaderScope value={{ toggle: paneToggle, expanded: !collapsed }}>
      <div className={collapsed ? 'flex shrink-0 flex-col' : 'contents'}>
        <WorkbenchSidebarHeader>
          <div className="relative flex h-full min-w-0 flex-1 items-center justify-between gap-1">
            {!(toolbar.searchOpen || toolbar.query) && creationActions}
            <div className="flex shrink-0 items-center gap-1">
              <CreationLibraryToolbar {...toolbar} />
            </div>
          </div>
        </WorkbenchSidebarHeader>
        {collapsed && (
          <div className="flex flex-col items-center gap-2 py-2">
            {creationActions}
            {collapsedSearch}
            <CreationLibraryFilterMenu
              filter={toolbar.filter}
              authors={toolbar.authors}
              onFilterChange={toolbar.onFilterChange}
            />
          </div>
        )}
      </div>
    </WorkbenchSidebarHeaderScope>
  );
}
