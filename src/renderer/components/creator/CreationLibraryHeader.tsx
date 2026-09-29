import { FolderPlusIcon, PlusIcon, SearchIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { CreationLibraryToolbar } from '@/renderer/components/creator/CreationLibraryToolbar';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props extends ComponentProps<typeof CreationLibraryToolbar> {
  collapsed: boolean;
  busy: boolean;
  canExpand: boolean;
  paneToggle: ReactNode;
  onExpand(): void;
  onNewCreation(): void;
  onNewAlbum(): void;
}

export function CreationLibraryHeader({
  collapsed,
  busy,
  canExpand,
  paneToggle,
  onExpand,
  onNewCreation,
  onNewAlbum,
  ...toolbar
}: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const creationActions = (
    <div className={cn('flex shrink-0 items-center gap-1', collapsed && 'flex-col gap-2')}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-action="new-creation"
        disabled={busy}
        title={labels.newCreation}
        aria-label={labels.newCreation}
        onClick={onNewCreation}
      >
        <PlusIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-action="new-album"
        disabled={busy}
        title={messages.creator.album.newAlbum}
        aria-label={messages.creator.album.newAlbum}
        onClick={onNewAlbum}
      >
        <FolderPlusIcon className="size-4" />
      </Button>
    </div>
  );

  if (collapsed) {
    return (
      <header className="grid shrink-0 place-items-center gap-2 py-2">
        {paneToggle}
        {creationActions}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={labels.search}
          aria-label={labels.search}
          disabled={!canExpand}
          onClick={() => {
            toolbar.onSearchOpenChange(true);
            onExpand();
          }}
        >
          <SearchIcon className="size-4" />
        </Button>
      </header>
    );
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-2">
      {paneToggle}
      <div className="relative flex h-full min-w-0 flex-1 items-center justify-between gap-2">
        {!(toolbar.searchOpen || toolbar.query) && creationActions}
        <div className="flex shrink-0 items-center gap-1">
          <CreationLibraryToolbar {...toolbar} />
        </div>
      </div>
    </header>
  );
}
