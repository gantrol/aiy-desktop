import { ChevronRightIcon, CircleXIcon, RotateCcwIcon, TablePropertiesIcon } from 'lucide-react';
import { useState } from 'react';
import type { AssetDto, AssetFileRevealContext, Locale } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { getMediaPreviewAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import {
  stackedMediaFrameLayerClassName,
  stackedMediaFrameLiftClassName,
  stackedMediaFrameStyle,
} from '@/renderer/components/ui/stacked-media-frame';
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
  organizeLabel?: string;
  canOrganize?(assetId: string): boolean;
  onOrganize?(assetId: string): void;
  contextActionsForAsset?(assetId: string): readonly ActionMenuAction[];
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
  organizeLabel?: string;
  canOrganize?(assetId: string): boolean;
  onOrganize?(assetId: string): void;
  contextActionsForAsset?(assetId: string): readonly ActionMenuAction[];
  notify(message: string): void;
  revealContextForAsset?(assetId: string): AssetFileRevealContext | undefined;
  experiment?: boolean;
  expanded?: boolean;
  failed?: boolean;
}

const OUTPUT_THUMBNAIL_MAX_WIDTH = 48;
const OUTPUT_THUMBNAIL_MAX_HEIGHT = 56;
const OUTPUT_THUMBNAIL_EXPANDED_GAP = 4;
const OUTPUT_THUMBNAIL_STACKED_STEP = 10;

function outputThumbnailFrame(asset: AssetDto) {
  const preview = getMediaPreviewAspectRatio(
    asset.width,
    asset.height,
    OUTPUT_THUMBNAIL_MAX_WIDTH / OUTPUT_THUMBNAIL_MAX_HEIGHT,
  );
  const boundsAspectRatio = OUTPUT_THUMBNAIL_MAX_WIDTH / OUTPUT_THUMBNAIL_MAX_HEIGHT;
  return {
    ...preview,
    ...(preview.aspectRatio >= boundsAspectRatio
      ? {
          width: OUTPUT_THUMBNAIL_MAX_WIDTH,
          height: OUTPUT_THUMBNAIL_MAX_WIDTH / preview.aspectRatio,
        }
      : {
          width: OUTPUT_THUMBNAIL_MAX_HEIGHT * preview.aspectRatio,
          height: OUTPUT_THUMBNAIL_MAX_HEIGHT,
        }),
  };
}

function outputThumbnailBackdrop(src: string) {
  return (
    <ImageAmbientBackdrop
      src={src}
      loading="lazy"
      imageClassName="scale-150 blur-md"
      scrimClassName="bg-background/5 dark:bg-background/10"
    />
  );
}

function AssetStack({
  label,
  assets,
  selectedAssetId,
  locale,
  onSelect,
  onSetFailed,
  busyRunIds,
  organizeLabel,
  canOrganize,
  onOrganize,
  contextActionsForAsset,
  notify,
  revealContextForAsset,
  experiment = false,
  expanded = false,
  failed = false,
}: AssetStackProps) {
  if (!assets.length) return null;
  const visible = expanded ? assets : assets.slice(0, 3);
  const frames = visible.map((item) => outputThumbnailFrame(item.asset));
  let nextExpandedOffset = 0;
  const expandedOffsets = frames.map((frame) => {
    const offset = nextExpandedOffset;
    nextExpandedOffset += frame.width + OUTPUT_THUMBNAIL_EXPANDED_GAP;
    return offset;
  });
  const width = expanded
    ? frames.reduce((total, frame) => total + frame.width, 0) +
      OUTPUT_THUMBNAIL_EXPANDED_GAP * Math.max(0, frames.length - 1)
    : frames.reduce(
        (maximum, frame, index) => Math.max(maximum, frame.width + OUTPUT_THUMBNAIL_STACKED_STEP * index),
        0,
      );
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
          const frame = frames[index];
          const thumbnailUrl = mediaThumbnailUrl(item.asset, 192);
          const actions: ActionMenuAction[] = [];
          if (item.kind !== 'IMPORTED_OUTPUT') {
            actions.push({
              id: failed ? 'restore-output' : 'mark-output-failed',
              label: actionLabel,
              icon: ActionIcon,
              destructive: !failed,
              disabled: busyRunIds.has(item.run.id),
              onSelect: () => onSetFailed(item, !failed),
            });
          }
          if (organizeLabel && canOrganize?.(item.asset.id) && onOrganize) {
            actions.push({
              id: 'organize-creation-outputs',
              label: organizeLabel,
              icon: TablePropertiesIcon,
              onSelect: () => onOrganize(item.asset.id),
            });
          }
          actions.push(...(contextActionsForAsset?.(item.asset.id) ?? []));
          return (
            <AssetFileContextMenu
              key={item.asset.id}
              assetId={item.asset.id}
              notify={notify}
              revealContext={revealContextForAsset?.(item.asset.id)}
              actions={actions}
            >
              <button
                data-output-asset-id={item.asset.id}
                type="button"
                aria-label={`${label} · ${index + 1}`}
                data-output-thumbnail-aspect-ratio={frame.aspectRatio.toFixed(3)}
                data-output-thumbnail-edge-fill={frame.needsEdgeFill ? 'true' : undefined}
                className={cn(
                  'absolute isolate overflow-hidden rounded-md bg-surface-sunken ring-1 ring-inset ring-foreground/10 outline-none transition-[box-shadow,opacity] duration-fast hover:ring-2 hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-ring',
                  stackedMediaFrameLayerClassName,
                  stackedMediaFrameLiftClassName,
                  failed && 'ring-destructive/40 opacity-75 hover:ring-destructive/70 hover:opacity-100',
                  selected && 'opacity-100 ring-2 ring-ring',
                )}
                style={stackedMediaFrameStyle(selected ? 20 : expanded ? 1 : 10 - index, {
                  top: (OUTPUT_THUMBNAIL_MAX_HEIGHT - frame.height) / 2,
                  left: expanded ? expandedOffsets[index] : index * OUTPUT_THUMBNAIL_STACKED_STEP,
                  width: frame.width,
                  height: frame.height,
                })}
                onClick={() => onSelect(item.asset.id)}
              >
                {frame.needsEdgeFill && outputThumbnailBackdrop(thumbnailUrl)}
                <img
                  data-asset-id={item.asset.id}
                  src={thumbnailUrl}
                  alt=""
                  className="relative z-10 size-full rounded-sm object-contain"
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
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
  organizeLabel,
  canOrganize,
  onOrganize,
  contextActionsForAsset,
  notify,
  revealContextForAsset,
}: Props) {
  const [expandedFailedGroupIds, setExpandedFailedGroupIds] = useState<Set<string>>(() => new Set());
  const [busyRunIds, setBusyRunIds] = useState<Set<string>>(() => new Set());

  async function setFailed(groupId: string, item: CreationOutputAssetProjection, failed: boolean) {
    if (item.kind === 'IMPORTED_OUTPUT') return;
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
          organizeLabel,
          canOrganize,
          onOrganize,
          contextActionsForAsset,
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
          {ungroupedAssets.map((asset, index) => {
            const frame = outputThumbnailFrame(asset);
            const thumbnailUrl = mediaThumbnailUrl(asset, 192);
            return (
              <span key={asset.id} className="grid h-14 w-12 shrink-0 place-items-center">
                <AssetFileContextMenu
                  assetId={asset.id}
                  notify={notify}
                  revealContext={revealContextForAsset?.(asset.id)}
                  actions={[
                    ...(organizeLabel && canOrganize?.(asset.id) && onOrganize
                      ? [
                          {
                            id: 'organize-creation-outputs',
                            label: organizeLabel,
                            icon: TablePropertiesIcon,
                            onSelect: () => onOrganize(asset.id),
                          },
                        ]
                      : []),
                    ...(contextActionsForAsset?.(asset.id) ?? []),
                  ]}
                >
                  <button
                    data-output-asset-id={asset.id}
                    data-output-thumbnail-aspect-ratio={frame.aspectRatio.toFixed(3)}
                    data-output-thumbnail-edge-fill={frame.needsEdgeFill ? 'true' : undefined}
                    type="button"
                    aria-label={`Output ${index + 1}`}
                    className={cn(
                      'relative isolate overflow-hidden rounded-md bg-surface-sunken ring-1 ring-inset ring-foreground/10 outline-none transition-shadow duration-fast hover:ring-2 hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-ring',
                      asset.id === selectedAssetId && 'ring-2 ring-ring',
                    )}
                    style={{ width: frame.width, height: frame.height }}
                    onClick={() => onSelect(asset.id)}
                  >
                    {frame.needsEdgeFill && outputThumbnailBackdrop(thumbnailUrl)}
                    <img
                      data-asset-id={asset.id}
                      src={thumbnailUrl}
                      alt=""
                      className="relative z-10 size-full rounded-sm object-contain"
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                      draggable={false}
                    />
                  </button>
                </AssetFileContextMenu>
              </span>
            );
          })}
        </section>
      )}
    </div>
  );
}
