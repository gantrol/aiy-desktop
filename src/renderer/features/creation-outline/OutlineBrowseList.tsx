import type { ComponentProps, ReactNode, RefObject } from 'react';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { OutlineTreeRow } from '@/renderer/features/creation-outline/OutlineTreeRow';
import { OutlineChildDisclosure } from '@/renderer/features/creation-outline/OutlineChildDisclosure';
import type { OutlineBrowseRow } from '@/renderer/features/creation-outline/outlineBrowseRows';
import type { OutlineNode } from '@/renderer/features/creation-outline/outline-tree';
import type { CreationOutlineView } from '@/renderer/features/creation-outline/useCreationOutlineView';
import type { useOutlineSelection } from '@/renderer/features/creation-outline/useOutlineSelection';
import type { useOutlineDrag } from '@/renderer/features/creation-outline/useOutlineDrag';

interface Props {
  leadingContent?: ReactNode;
  viewportRef: RefObject<HTMLDivElement | null>;
  browseRows: readonly OutlineBrowseRow[];
  active: boolean;
  busy: boolean;
  loading: boolean;
  currentKey: string | null;
  expandedKeys: ReadonlySet<string>;
  visibility: CreationOutlineView['childVisibility'];
  selection: ReturnType<typeof useOutlineSelection>;
  drag: ReturnType<typeof useOutlineDrag>;
  organization: ComponentProps<typeof OutlineTreeRow>['organization'];
  nodeActions: ComponentProps<typeof OutlineTreeRow>['nodeActions'];
  query: string;
  scopeActions: ReactNode;
  path(node: OutlineNode): string;
  open(key: string): void;
  focus(key: string): void;
  toggle(key: string, wholeBranch: boolean): void;
  move(node: OutlineNode): void;
  openSource(node: OutlineNode): void;
  clearSearch(): void;
}

export function OutlineBrowseList({
  leadingContent,
  viewportRef,
  browseRows,
  active,
  busy,
  loading,
  currentKey,
  expandedKeys,
  visibility,
  selection,
  drag,
  organization,
  nodeActions,
  query,
  scopeActions,
  path,
  open,
  focus,
  toggle,
  move,
  openSource,
  clearSearch,
}: Props) {
  const labels = useI18n().messages.creator.outline;
  return (
    <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
      {leadingContent}
      <div
        role="tree"
        aria-label={labels.title}
        aria-multiselectable="true"
        aria-busy={loading}
        className="min-h-40 py-1"
      >
        {browseRows.map((entry) => {
          if (entry.kind === 'disclosure')
            return <OutlineChildDisclosure key={entry.key} row={entry} busy={busy} visibility={visibility} />;
          const { row } = entry;
          return (
            <OutlineTreeRow
              key={row.node.key}
              row={row}
              active={active}
              current={currentKey === row.node.key}
              path={path(row.node)}
              expanded={expandedKeys.has(row.node.key)}
              collapsible
              selected={selection.selection.includes(row.node.key)}
              focused={selection.focusKey === row.node.key}
              drop={drag.dropKey === row.node.key}
              busy={busy}
              organization={organization}
              nodeActions={nodeActions}
              elementRef={(element) => {
                if (element) selection.elements.current.set(row.node.key, element);
                else selection.elements.current.delete(row.node.key);
              }}
              onChoose={(event) => selection.choose(row.node.key, event.shiftKey, event.ctrlKey || event.metaKey)}
              onKeyDown={(event) => selection.onKeyDown(event, row)}
              onToggle={(wholeBranch) => {
                toggle(row.node.key, wholeBranch);
                selection.focusRow(row.node.key);
              }}
              onFocus={() => focus(row.node.key)}
              onOpen={() => open(row.node.key)}
              onMove={() => move(row.node)}
              onOpenSource={row.node.content?.referenceId ? () => openSource(row.node) : undefined}
              onDragStart={(event) => drag.start(event, row.node.key)}
              onDragEnd={drag.clear}
              onDragOver={(event) => drag.overNode(event, row.node)}
              onDrop={(event) => drag.dropNode(event, row.node)}
            />
          );
        })}
      </div>
      {browseRows.length === 0 && !leadingContent && (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          {query.trim() ? labels.noMatches : labels.empty}
          {query.trim() ? (
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              {labels.clear}
            </Button>
          ) : (
            scopeActions
          )}
        </div>
      )}
    </ScrollArea>
  );
}
