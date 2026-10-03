import { ChevronRightIcon, FilePenLineIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { ActionMenuButton } from '@/renderer/components/ui/action-menu';
import { CreationLibraryTreeItem } from '@/renderer/components/creator/CreationLibraryTreeItem';
import { CREATION_TREE_COMPACT_NODE_METRICS } from '@/renderer/components/albums/treeConnectionGeometry';
import type { useCreationDraftList } from '@/renderer/components/creator/useCreationDraftList';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  drafts: ReturnType<typeof useCreationDraftList>;
  selectedId: string | null;
  busy: boolean;
  onSelect(id: string): void;
  onDelete(id: string): void;
  onClear(): void;
}

export function CreationDraftList({ drafts, selectedId, busy, onSelect, onDelete, onClear }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  if (!drafts.items.length && !drafts.failed) return null;
  return (
    <Collapsible defaultOpen asChild>
      <section
        aria-label={labels.savedDrafts}
        className="flex min-h-0 max-h-[35%] shrink-0 flex-col border-t border-border/60"
        aria-busy={drafts.loading || busy}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-1">
          <h3 className="min-w-0 flex-1">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="group w-full min-w-0 justify-start gap-1 px-0 text-muted-foreground"
              >
                <ChevronRightIcon aria-hidden="true" className="size-3.5 group-data-[state=open]:rotate-90" />
                <span className="truncate">{labels.savedDrafts}</span>
              </Button>
            </CollapsibleTrigger>
          </h3>
          {drafts.items.length > 0 && (
            <ActionMenuButton
              label={`${labels.savedDrafts} · ${messages.creator.album.moreActions}`}
              side="top"
              align="end"
              actions={[
                {
                  id: 'clear-drafts',
                  label: labels.clearDrafts,
                  icon: Trash2Icon,
                  destructive: true,
                  disabled: busy,
                  onSelect: onClear,
                },
              ]}
            />
          )}
        </header>
        <CollapsibleContent asChild>
          <ScrollArea className="min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block">
            <div className="px-2 pb-2">
              {drafts.items.map((draft) => {
                const title = draft.title.trim() || draft.preview.trim().replace(/\s+/gu, ' ') || labels.untitledDraft;
                return (
                  <CreationLibraryTreeItem
                    key={draft.id}
                    compact
                    selected={draft.id === selectedId}
                    title={title}
                    ariaLabel={labels.openItemLabel(title)}
                    openLabel={labels.openItemLabel(title)}
                    preview={
                      <span className="ml-7 grid size-7 place-items-center text-muted-foreground">
                        <FilePenLineIcon className="size-5" aria-hidden="true" />
                      </span>
                    }
                    previewBounds={CREATION_TREE_COMPACT_NODE_METRICS.bounds}
                    previewStyle={{ width: CREATION_TREE_COMPACT_NODE_METRICS.width }}
                    dataAttributes={{ 'data-creation-draft-id': draft.id }}
                    aria-disabled={busy}
                    controls={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="pointer-events-none absolute top-1/2 right-1 z-20 size-6 -translate-y-1/2 rounded-sm text-muted-foreground opacity-0 hover:text-destructive group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                        title={labels.deleteDraft}
                        aria-label={labels.deleteDraftLabel(title)}
                        disabled={busy}
                        onClick={() => onDelete(draft.id)}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    }
                    onOpen={() => {
                      if (!busy) onSelect(draft.id);
                    }}
                  />
                );
              })}
              {(drafts.failed || drafts.nextCursor) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={drafts.loading}
                  onClick={() => (drafts.failed ? drafts.refresh() : void drafts.loadMore())}
                >
                  {drafts.loading && <LoaderCircleIcon className="size-3.5 animate-spin" />}
                  {drafts.failed ? labels.retryDrafts : labels.showMoreChildren}
                </Button>
              )}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
