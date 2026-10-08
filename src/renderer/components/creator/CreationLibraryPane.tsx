import type { ComponentProps, ReactNode } from 'react';
import { itemDragScopeProps } from '@/renderer/components/albums/itemDrag';
import { CreationDraftSidebarContent } from '@/renderer/components/creator/CreationDraftSidebarState';
import { CreationLibraryHeader } from '@/renderer/components/creator/CreationLibraryHeader';
import { CreationLibrarySearchPopover } from '@/renderer/components/creator/CreationLibrarySearchPopover';
import type { useCreationLibrarySearch } from '@/renderer/components/creator/useCreationLibrarySearch';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props extends Omit<
  ComponentProps<typeof CreationLibraryHeader>,
  'collapsedSearch' | 'searchOpen' | 'onSearchOpenChange' | 'query' | 'onQueryChange'
> {
  search: ReturnType<typeof useCreationLibrarySearch>;
  results: ReactNode;
  resizeHandle: ReactNode;
  children: ReactNode;
}

export function CreationLibraryPane({ collapsed, search, results, resizeHandle, children, ...header }: Props) {
  const labels = useI18n().messages.creator.results;
  const toolbar = {
    query: search.query,
    onQueryChange: search.setQuery,
    searchOpen: search.searchOpen,
    onSearchOpenChange: search.setSearchOpen,
    filter: header.filter,
    onFilterChange: header.onFilterChange,
    authors: header.authors,
  };

  return (
    <aside
      {...itemDragScopeProps}
      aria-label={labels.library}
      className="relative isolate flex size-full min-h-0 min-w-0 flex-col border-r bg-surface-sunken"
    >
      {resizeHandle}
      <CreationLibraryHeader
        {...header}
        {...toolbar}
        collapsed={collapsed}
        collapsedSearch={
          <CreationLibrarySearchPopover
            {...toolbar}
            open={search.popoverOpen}
            onOpenChange={search.onPopoverOpenChange}
            restoreFocus={search.restorePopoverFocus}
          >
            {results}
          </CreationLibrarySearchPopover>
        }
      />
      {collapsed ? <div className="min-h-0 flex-1" /> : results}
      {!collapsed && <CreationDraftSidebarContent />}
      {children}
    </aside>
  );
}
