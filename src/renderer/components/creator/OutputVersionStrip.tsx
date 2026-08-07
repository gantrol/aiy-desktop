import { ChevronRightIcon, CircleXIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import type { AssetDto, AssetFileRevealContext, Locale } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import type {
  CreationOutputAssetProjection,
  CreationOutputDirectionStack,
  CreationOutputVersionGroup,
} from '@/renderer/components/creator/creationOutputProjection';

interface Props {
  groups: CreationOutputVersionGroup[];
  ungroupedAssets?: AssetDto[];
  selectedAssetId: string | null;
  locale: Locale;
  onSelect(assetId: string): void;
  onSetFailed(runId: string, failed: boolean): Promise<void>;
  notify(message: string): void;
  revealContextForAsset?(assetId: string): AssetFileRevealContext | undefined;
}

interface AssetStackProps {
  label: string;
  assets: CreationOutputAssetProjection[];
  selectedAssetId: string | null;
  locale: Locale;
  onSelect(assetId: string): void;
  onSetFailed(item: CreationOutputAssetProjection, failed: boolean): void;
  busyRunIds: ReadonlySet<string>;
  notify(message: string): void;
  revealContextForAsset?(assetId: string): AssetFileRevealContext | undefined;
  experiment?: boolean;
  expanded?: boolean;
  failed?: boolean;
}

function AssetStack({
  label,
  assets,
  selectedAssetId,
  locale,
  onSelect,
  onSetFailed,
  busyRunIds,
  notify,
  revealContextForAsset,
  experiment = false,
  expanded = false,
  failed = false,
}: AssetStackProps) {
  if (!assets.length) return null;
  const visible = expanded ? assets : assets.slice(0, 3);
  const thumbnailWidth = 48;
  const expandedGap = 4;
  const stackedStep = 10;
  const width = expanded
    ? thumbnailWidth * visible.length + expandedGap * (visible.length - 1)
    : thumbnailWidth + stackedStep * (visible.length - 1);
  const renderedAssets = expanded ? visible : [...visible].reverse();
  const actionLabel = failed
    ? locale === 'zh'
      ? '恢复显示'
      : 'Restore output'
    : locale === 'zh'
      ? '标记为失败'
      : 'Mark as failed';
  const ActionIcon = failed ? RotateCcwIcon : CircleXIcon;

  return (
    <div
      data-output-asset-stack={label}
      data-output-asset-layout={expanded ? 'expanded' : 'stacked'}
      data-output-disposition={failed ? 'failed' : 'visible'}
      className="shrink-0"
    >
      <div className="mb-1 flex h-4 items-center gap-1 px-0.5">
        <span
          className={cn(
            'text-[9px] font-semibold tabular-nums',
            failed ? 'text-destructive' : experiment ? 'text-primary' : 'text-foreground-secondary',
          )}
        >
          {label}
        </span>
        {assets.length > 1 && <span className="text-[9px] text-muted-foreground">×{assets.length}</span>}
      </div>
      <div className="relative h-14" style={{ width: `${width}px` }}>
        {renderedAssets.map((item, renderedIndex) => {
          const index = expanded ? renderedIndex : visible.length - renderedIndex - 1;
          const selected = item.asset.id === selectedAssetId;
          return (
            <AssetFileContextMenu
              key={item.asset.id}
              assetId={item.asset.id}
              notify={notify}
              revealContext={revealContextForAsset?.(item.asset.id)}
              actions={[
                {
                  id: failed ? 'restore-output' : 'mark-output-failed',
                  label: actionLabel,
                  icon: ActionIcon,
                  destructive: !failed,
                  disabled: busyRunIds.has(item.run.id),
                  onSelect: () => onSetFailed(item, !failed),
                },
              ]}
            >
              <button
                data-output-asset-id={item.asset.id}
                type="button"
                aria-label={`${label} · ${index + 1}`}
                className={cn(
                  'absolute top-0 h-14 w-12 overflow-hidden rounded-md border-2 border-background bg-media-surround-light p-0.5 outline-none transition-colors hover:border-border-strong focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring',
                  failed && 'border-destructive/40 opacity-75 hover:border-destructive/70 hover:opacity-100',
                  selected && 'z-10 border-selected-border opacity-100 ring-2 ring-ring',
                )}
                style={{
                  left: `${index * (expanded ? thumbnailWidth + expandedGap : stackedStep)}px`,
                  zIndex: selected ? 20 : expanded ? 1 : 10 - index,
                }}
                onClick={() => onSelect(item.asset.id)}
              >
                <img
                  src={item.asset.mediaUrl}
                  alt=""
                  className="size-full rounded-sm object-contain"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              </button>
            </AssetFileContextMenu>
          );
        })}
      </div>
    </div>
  );
}

function directionAssets(stack: CreationOutputDirectionStack) {
  return stack.assets;
}

export function OutputVersionStrip({
  groups,
  ungroupedAssets = [],
  selectedAssetId,
  locale,
  onSelect,
  onSetFailed,
  notify,
  revealContextForAsset,
}: Props) {
  const [expandedFailedGroupIds, setExpandedFailedGroupIds] = useState<Set<string>>(() => new Set());
  const [busyRunIds, setBusyRunIds] = useState<Set<string>>(() => new Set());

  async function setFailed(groupId: string, item: CreationOutputAssetProjection, failed: boolean) {
    if (busyRunIds.has(item.run.id)) return;
    if (failed) {
      setExpandedFailedGroupIds((current) => {
        if (!current.has(groupId)) return current;
        const next = new Set(current);
        next.delete(groupId);
        return next;
      });
    }
    setBusyRunIds((current) => new Set(current).add(item.run.id));
    try {
      await onSetFailed(item.run.id, failed);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRunIds((current) => {
        const next = new Set(current);
        next.delete(item.run.id);
        return next;
      });
    }
  }

  return (
    <div
      data-output-version-strip
      className="flex h-28 shrink-0 items-end gap-4 overflow-x-auto border-t border-border/60 bg-surface-sunken px-4 py-3"
    >
      {groups.map((group) => {
        const visibleDirections = group.directionStacks.filter((stack) => stack.assets.length > 0);
        const failedDirections = group.directionStacks.filter((stack) => stack.failedAssets.length > 0);
        const failedCount =
          group.failedPrimaryAssets.length +
          failedDirections.reduce((total, stack) => total + stack.failedAssets.length, 0);
        if (!group.primaryAssets.length && !visibleDirections.length && failedCount === 0) return null;
        const failedOpen = expandedFailedGroupIds.has(group.id);
        const commonStackProps = {
          selectedAssetId,
          locale,
          onSelect,
          busyRunIds,
          notify,
          revealContextForAsset,
        };
        return (
          <section
            key={group.id}
            data-output-version-group={group.versionLabel}
            className="flex shrink-0 items-end gap-1.5 rounded-lg border border-border/60 bg-background/55 px-2 py-1.5"
          >
            <AssetStack
              {...commonStackProps}
              label={group.versionLabel}
              assets={group.primaryAssets}
              onSetFailed={(item, failed) => void setFailed(group.id, item, failed)}
              expanded
            />
            {group.primaryAssets.length > 0 && visibleDirections.length > 0 && (
              <span className="mb-1 h-14 w-px bg-border" aria-hidden="true" />
            )}
            {visibleDirections.length > 0 && (
              <div
                data-output-direction-layout="stacked-hover"
                className="group/direction-versions flex shrink-0 items-end pr-0.5"
              >
                {visibleDirections.map((stack, index) => (
                  <div
                    key={stack.id}
                    data-output-direction-version={stack.versionLabel}
                    className={cn(
                      'relative shrink-0 rounded-md bg-background/95 px-0.5 transition-[margin] duration-200 ease-out motion-reduce:transition-none',
                      index > 0 &&
                        '-ml-9 group-hover/direction-versions:ml-1.5 group-focus-within/direction-versions:ml-1.5',
                    )}
                    style={{ zIndex: index + 1 }}
                  >
                    <AssetStack
                      {...commonStackProps}
                      label={stack.versionLabel}
                      assets={directionAssets(stack)}
                      onSetFailed={(item, failed) => void setFailed(group.id, item, failed)}
                      experiment
                    />
                  </div>
                ))}
              </div>
            )}
            {failedCount > 0 && (
              <>
                {(group.primaryAssets.length > 0 || visibleDirections.length > 0) && (
                  <span className="mb-1 h-14 w-px bg-border" aria-hidden="true" />
                )}
                <Collapsible
                  open={failedOpen}
                  onOpenChange={(open) =>
                    setExpandedFailedGroupIds((current) => {
                      const next = new Set(current);
                      if (open) next.add(group.id);
                      else next.delete(group.id);
                      return next;
                    })
                  }
                  className="flex shrink-0 items-end gap-1.5"
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="mb-1 flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted/70 text-[9px] font-medium text-muted-foreground outline-none transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRightIcon className={cn('size-3.5 transition-transform', failedOpen && 'rotate-90')} />
                      <span>
                        {locale === 'zh' ? '失败' : 'Failed'} {failedCount}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex items-end gap-1.5">
                    <AssetStack
                      {...commonStackProps}
                      label={group.versionLabel}
                      assets={group.failedPrimaryAssets}
                      onSetFailed={(item, failed) => void setFailed(group.id, item, failed)}
                      expanded
                      failed
                    />
                    {failedDirections.map((stack) => (
                      <AssetStack
                        key={stack.id}
                        {...commonStackProps}
                        label={stack.versionLabel}
                        assets={stack.failedAssets}
                        onSetFailed={(item, failed) => void setFailed(group.id, item, failed)}
                        expanded
                        failed
                        experiment
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </section>
        );
      })}
      {ungroupedAssets.length > 0 && (
        <section className="flex shrink-0 items-end gap-1.5 rounded-lg border border-border/60 bg-background/55 px-2 py-1.5">
          {ungroupedAssets.map((asset, index) => (
            <AssetFileContextMenu
              key={asset.id}
              assetId={asset.id}
              notify={notify}
              revealContext={revealContextForAsset?.(asset.id)}
            >
              <button
                data-output-asset-id={asset.id}
                type="button"
                aria-label={`Output ${index + 1}`}
                className={cn(
                  'h-14 w-12 overflow-hidden rounded-md border-2 border-transparent bg-media-surround-light p-0.5 outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring',
                  asset.id === selectedAssetId && 'border-selected-border ring-2 ring-ring',
                )}
                onClick={() => onSelect(asset.id)}
              >
                <img
                  src={asset.mediaUrl}
                  alt=""
                  className="size-full rounded-sm object-contain"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              </button>
            </AssetFileContextMenu>
          ))}
        </section>
      )}
    </div>
  );
}
