import type { ReactNode } from 'react';
import type { AssetDto } from '@/shared/contracts';
import {
  TreeBranchCollapseProvider,
  TreeBranchCollapseRail,
  TreeBranchContent,
  TreeBranchTransitRail,
  TreeDisclosureRail,
} from '@/renderer/components/albums/TreeDisclosureRail';
import {
  getTreeBranchItemTopology,
  getTreeNodeAnchor,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import {
  CreationLibraryTreeItem,
  getCreationTreeMediaNodeMetrics,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
import {
  animationGroupOpenTarget,
  type CreationAnimationGroup as AnimationGroup,
} from '@/renderer/components/creator/creationAnimationGroups';
import type { CreationFormProjection } from '@/renderer/components/creator/creationLibraryProjection';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import type { useTreeBranchExpansion } from '@/renderer/components/albums/useTreeBranchExpansion';
import { Collapsible, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  group: AnimationGroup;
  topology: TreeBranchItemTopology;
  selectedFormId: string | null;
  expansion: ReturnType<typeof useTreeBranchExpansion>;
  formAssets(form: CreationFormProjection): AssetDto[];
  onOpen(form: CreationFormProjection): void;
  renderForm(form: CreationFormProjection, topology: TreeBranchItemTopology, compact: boolean): ReactNode;
}

export function CreationAnimationGroup({
  group,
  topology,
  selectedFormId,
  expansion,
  formAssets,
  onOpen,
  renderForm,
}: Props) {
  const { messages } = useI18n();
  const open = expansion.isOpen(group.key);
  const setOpen = (open: boolean) => expansion.setPersistent(group.key, open);
  const labels = messages.creator.album;
  const title = labels.animationGroup(group.forms.length);
  const selected = group.forms.some((form) => form.form.id === selectedFormId);
  const target = animationGroupOpenTarget(group, selectedFormId);
  const assets = [...new Map([target, ...group.forms].flatMap(formAssets).map((asset) => [asset.id, asset])).values()];
  const items = assets.map((asset) => ({ asset }));
  const metrics = getCreationTreeMediaNodeMetrics(items);
  const disclosureLabel = open ? labels.collapseAnimationGroup : labels.expandAnimationGroup;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="relative"
      data-tree-branch-id={group.key}
      data-animation-group
    >
      <TreeBranchTransitRail topology={topology} />
      <CreationLibraryTreeItem
        selected={selected && !open}
        branchTopology={topology}
        ariaLabel={title}
        openLabel={`${labels.open}: ${title}`}
        title={title}
        dataAttributes={{ 'data-tree-node-id': group.key }}
        previewBounds={metrics.bounds}
        previewStyle={{ width: metrics.width }}
        canSpreadPreview={assets.length > 1}
        childBranch={{ open }}
        onGestureExpand={() => expansion.expandFromGesture(group.key)}
        onPointerTrackStart={(clientY) => expansion.beginPointerTrack(group.key, clientY)}
        onPointerTrack={(clientY) => expansion.trackPointer(group.key, clientY)}
        preview={(expanded) => (
          <span className="relative grid h-full w-full place-items-center">
            <MediaStackPreview
              className="pointer-events-none"
              size="tree"
              singleItemAlign="center"
              items={items}
              maxItems={3}
              spread={expanded ? 'expanded' : open ? 'settled' : 'collapsed'}
            />
            <CollapsibleTrigger asChild>
              <TreeDisclosureRail
                open={open}
                attached
                label={disclosureLabel}
                anchor={getTreeNodeAnchor(metrics.bounds)}
                onClick={(event) => event.stopPropagation()}
              />
            </CollapsibleTrigger>
          </span>
        )}
        onOpen={() => onOpen(target)}
      />
      {open && <TreeBranchCollapseRail label={disclosureLabel} onCollapse={() => setOpen(false)} />}
      <TreeBranchContent>
        <TreeBranchCollapseProvider onCollapse={() => setOpen(false)}>
          {group.forms.map((form, index) =>
            renderForm(form, getTreeBranchItemTopology(index, group.forms.length), true),
          )}
        </TreeBranchCollapseProvider>
      </TreeBranchContent>
    </Collapsible>
  );
}
