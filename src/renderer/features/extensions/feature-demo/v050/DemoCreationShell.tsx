import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pin, ImageIcon } from 'lucide-react';
import { AppSidebar } from '@/renderer/components/app/AppSidebar';
import { CreationLibraryToolbar } from '@/renderer/components/creator/CreationLibraryToolbar';
import { CreationLibraryTreeItem } from '@/renderer/components/creator/CreationLibraryTreeItem';
import { allCreationLibraryFilters } from '@/renderer/components/creator/creationLibraryFilter';
import { Button } from '@/renderer/components/ui/button';
import { Badge } from '@/renderer/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { demoMedia } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';
import { aiyIdentityUrl } from '@/renderer/components/brand/AiyIdentity';
import { demoNoop } from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
import { demoWorkspaceLayout } from '@/renderer/features/extensions/feature-demo/v050/demoWorkspaceScene';

function DemoCreationLibrary() {
  const { messages } = useI18n();
  const copy = messages.extensions.featureDemo.v050;
  const library = messages.creator.results;
  return (
    <aside className="min-h-0 overflow-hidden border-r bg-muted/50">
      <header className="relative flex h-14 items-center gap-1 border-b px-3">
        <strong className="mr-auto text-base">{library.library}</strong>
        <Button variant="outline" size="icon-sm" aria-label={library.newCreation} onClick={demoNoop}>
          <Plus />
        </Button>
        <CreationLibraryToolbar
          searchOpen={false}
          query=""
          filter={allCreationLibraryFilters}
          onSearchOpenChange={demoNoop}
          onQueryChange={demoNoop}
          onFilterChange={demoNoop}
        />
      </header>
      <div className="space-y-1 px-2 py-3">
        {[
          { id: 'demo-library', title: 'AIY', selected: false },
          { id: 'demo-input', title: copy.noteText, selected: true },
        ].map((item) => (
          <CreationLibraryTreeItem
            key={item.id}
            selected={item.selected}
            title={item.title}
            ariaLabel={item.title}
            openLabel={item.title}
            onOpen={demoNoop}
            previewBounds={{ left: 6, top: 4, right: 60, bottom: 56 }}
            previewStyle={{ width: 64, height: 60 }}
            preview={
              <img
                src={item.id === 'demo-library' ? aiyIdentityUrl : demoMedia.character}
                alt=""
                className="absolute left-1.5 top-1 h-[52px] w-[54px] rounded-sm object-contain"
              />
            }
            metadata={<ImageIcon className="size-3" />}
            controls={!item.selected ? <Pin className="size-3 text-muted-foreground" /> : undefined}
          />
        ))}
      </div>
    </aside>
  );
}

export function DemoCreationShell({ children, gif }: { children: ReactNode; gif: boolean }) {
  const { messages } = useI18n();
  return (
    <div className="absolute inset-0 flex flex-col bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted px-4">
        <span className="mr-3 text-sm font-semibold">AIY</span>
        <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-hidden="true">
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-hidden="true">
          <ChevronRight />
        </Button>
        <Badge variant="outline" className="ml-auto">
          {messages.extensions.featureDemo.v050.prepared}
        </Badge>
      </header>
      <Tabs value={gif ? 'gif' : 'image'} className="h-10 shrink-0 border-b bg-muted/50 pl-[88px]">
        <TabsList className="h-full justify-start rounded-none bg-transparent">
          <TabsTrigger value="image" className="min-w-44">
            {messages.creator.workbench.creationModeImage}
          </TabsTrigger>
          {gif && (
            <TabsTrigger value="gif" className="min-w-44">
              {messages.creator.gifMaker.workspaceTitle}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          spaceName="AIY"
          spaceCoverUrl={null}
          spaceTransitioning={false}
          libraryBusy={false}
          codexImagesVisible
          transitionShowcaseVisible={false}
          view="creator"
          onViewChange={demoNoop}
          onSettingsOpen={demoNoop}
          notify={demoNoop}
        />
        <div
          className="grid min-h-0 flex-1"
          style={{ gridTemplateColumns: `${demoWorkspaceLayout.library}px minmax(0,1fr)` }}
        >
          <DemoCreationLibrary />
          {children}
        </div>
      </div>
    </div>
  );
}
