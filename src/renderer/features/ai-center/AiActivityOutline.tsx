import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, CircleIcon, FileTextIcon, ImageIcon, PencilLineIcon } from 'lucide-react';
import { AssetMedia, isVideoAsset } from '@/renderer/components/media/AssetMedia';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AiActivityRow } from '@/renderer/features/ai-center/AiActivityRow';
import { activityStatusFilter, type AiActivityRecord } from '@/renderer/features/ai-center/activityProjection';
import type {
  AiActivityOutlineNode,
  AiActivityOutcomeGroup,
} from '@/renderer/features/ai-center/outcomeOutlineProjection';

interface Props {
  groups: AiActivityOutcomeGroup[];
  selectedId: string | null;
  currentDraftId: string | null;
  modelNameByKey: ReadonlyMap<string, string>;
  dateFormatter: Intl.DateTimeFormat;
  now: number;
  onSelect(recordId: string): void;
}

const AI_ACTIVITY_COVER_THUMBNAIL_SIZE = 96;

function groupRecords(group: AiActivityOutcomeGroup) {
  const records: AiActivityRecord[] = [];
  function visit(nodes: readonly AiActivityOutlineNode[]) {
    for (const node of nodes) {
      records.push(node.record);
      visit(node.children);
    }
  }
  visit(group.nodes);
  return records;
}

function OutcomeIcon({ group }: { group: AiActivityOutcomeGroup }) {
  if (group.kind === 'DOCUMENT') return <FileTextIcon className="size-4" />;
  if (group.kind === 'DRAFT') return <PencilLineIcon className="size-4" />;
  if (group.kind === 'CREATION') return <ImageIcon className="size-4" />;
  return <CircleIcon className="size-4" />;
}

interface NodeBranchProps extends Omit<Props, 'groups'> {
  node: AiActivityOutlineNode;
  depth: number;
}

function NodeBranch({
  node,
  depth,
  selectedId,
  currentDraftId,
  modelNameByKey,
  dateFormatter,
  now,
  onSelect,
}: NodeBranchProps) {
  return (
    <div role="listitem">
      <AiActivityRow
        record={node.record}
        selected={node.record.id === selectedId}
        currentDraftId={currentDraftId}
        modelNameByKey={modelNameByKey}
        dateFormatter={dateFormatter}
        now={now}
        variant="OUTLINE"
        onSelect={onSelect}
      />
      {node.children.length > 0 && (
        <div role="list" className={cn('border-l border-selected-border/70 pl-2', depth < 2 ? 'ml-[22px]' : 'ml-2')}>
          {node.children.map((child) => (
            <NodeBranch
              key={child.record.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              currentDraftId={currentDraftId}
              modelNameByKey={modelNameByKey}
              dateFormatter={dateFormatter}
              now={now}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AiActivityOutline({
  groups,
  selectedId,
  currentDraftId,
  modelNameByKey,
  dateFormatter,
  now,
  onSelect,
}: Props) {
  const l = useI18n().messages.aiCenter;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const revealedSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      revealedSelectionRef.current = null;
      return;
    }
    if (revealedSelectionRef.current === selectedId) return;
    const selectedGroup = groups.find((group) => groupRecords(group).some((record) => record.id === selectedId));
    if (!selectedGroup) return;
    revealedSelectionRef.current = selectedId;
    setExpandedIds((current) => {
      if (current.has(selectedGroup.id)) return current;
      const next = new Set(current);
      next.add(selectedGroup.id);
      return next;
    });
  }, [groups, selectedId]);

  function toggleGroup(groupId: string, open: boolean) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (open) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }

  function groupTitle(group: AiActivityOutcomeGroup) {
    if (group.title) return group.title;
    if (group.kind === 'DRAFT') return l.source.draft;
    if (group.kind === 'DOCUMENT') return l.outline.document;
    if (group.kind === 'CREATION') return l.outline.creation;
    return l.outline.unassigned;
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div role="list" aria-label={l.outline.ariaLabel} className="divide-y">
        {groups.map((group) => {
          const open = expandedIds.has(group.id);
          const title = groupTitle(group);
          const groupedRecords = groupRecords(group);
          const runningCount = groupedRecords.filter((record) => activityStatusFilter(record) === 'RUNNING').length;
          const attentionCount = groupedRecords.filter((record) => activityStatusFilter(record) === 'ATTENTION').length;
          return (
            <Collapsible
              key={group.id}
              role="listitem"
              open={open}
              onOpenChange={(nextOpen) => toggleGroup(group.id, nextOpen)}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-expanded={open}
                  className="group grid w-full grid-cols-[16px_38px_minmax(0,1fr)] items-center gap-2.5 px-3 py-3 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={open ? l.outline.collapse(title) : l.outline.expand(title)}
                >
                  <ChevronDownIcon
                    className={cn('size-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')}
                  />
                  <span className="grid size-[38px] place-items-center overflow-hidden rounded-md bg-surface-sunken text-foreground-secondary">
                    {group.cover ? (
                      <AssetMedia
                        asset={group.cover}
                        src={
                          isVideoAsset(group.cover)
                            ? group.cover.mediaUrl
                            : mediaThumbnailUrl(group.cover, AI_ACTIVITY_COVER_THUMBNAIL_SIZE)
                        }
                        alt={title}
                        loading="lazy"
                        className="size-full bg-media-surround-light object-contain"
                      />
                    ) : (
                      <OutcomeIcon group={group} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <strong className="min-w-0 flex-1 truncate text-sm font-medium">{title}</strong>
                      {runningCount > 0 && (
                        <span className="shrink-0 text-2xs font-medium text-selected-foreground">
                          {l.stats.running} {runningCount}
                        </span>
                      )}
                      {attentionCount > 0 && (
                        <span className="shrink-0 text-2xs font-medium text-destructive">
                          {l.filters.attention} {attentionCount}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
                      <span>{l.outline.callCount(group.recordCount)}</span>
                      <span>·</span>
                      <time dateTime={group.latestAt}>{dateFormatter.format(new Date(group.latestAt))}</time>
                    </span>
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t bg-surface/35">
                <div role="list" className="ml-[30px] border-l border-selected-border/70 pl-2">
                  {group.nodes.map((node) => (
                    <NodeBranch
                      key={node.record.id}
                      node={node}
                      depth={0}
                      selectedId={selectedId}
                      currentDraftId={currentDraftId}
                      modelNameByKey={modelNameByKey}
                      dateFormatter={dateFormatter}
                      now={now}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </ScrollArea>
  );
}
