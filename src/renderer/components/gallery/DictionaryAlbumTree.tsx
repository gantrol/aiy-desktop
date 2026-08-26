import { BookOpenIcon, ShapesIcon, TagIcon } from 'lucide-react';
import { useLayoutEffect, useState, type AnimationEvent, type ReactNode } from 'react';
import type { GalleryDictionaryCollection } from '@/renderer/components/app/app-navigation';
import { cn } from '@/renderer/lib/utils';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { createAlbumExpansionAction } from '@/renderer/components/albums/albumTreeMenuActions';
import {
  TreeBranchCollapseRail,
  TreeBranchCollapseProvider,
  TreeBranchContent,
  TreeBranchTransitRail,
} from '@/renderer/components/albums/TreeDisclosureRail';
import {
  getTreeBranchItemTopology,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import {
  useTreeBranchExpansion,
  type TreeBranchDiagnosticSink,
} from '@/renderer/components/albums/useTreeBranchExpansion';
import { useDeferredSingleDoubleClick } from '@/renderer/components/albums/useDeferredSingleDoubleClick';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import type {
  DictionaryMaterialDomainNode,
  DictionaryMaterialTermNode,
  DictionaryMaterialTree,
  DictionaryMaterialTypeNode,
} from '@/renderer/components/gallery/dictionaryMaterialTree';

const pageSize = 30;

interface Props {
  tree: DictionaryMaterialTree;
  selection: GalleryDictionaryCollection | null;
  expansion: ReturnType<typeof useTreeBranchExpansion>;
  click: ReturnType<typeof useDeferredSingleDoubleClick>;
  diagnostics?: TreeBranchDiagnosticSink;
  openLabel: string;
  expandLabel: string;
  collapseLabel: string;
  moreLabel: string;
  moreActionsLabel(title: string): string;
  onSelect(collection: GalleryDictionaryCollection): void;
}

type DictionaryBranch = DictionaryMaterialDomainNode | DictionaryMaterialTypeNode;

function branchKey(node: DictionaryBranch) {
  return node.id;
}

export function DictionaryAlbumTree({
  tree,
  selection,
  expansion,
  click,
  diagnostics,
  openLabel,
  expandLabel,
  collapseLabel,
  moreLabel,
  moreActionsLabel,
  onSelect,
}: Props) {
  const [visibleTermsByType, setVisibleTermsByType] = useState<Record<string, number>>({});
  const scope = selection?.scope ?? 'ALL';

  function traceBranchAnimation(
    albumId: string,
    contentDepth: number,
    itemCount: number,
    phase: 'start' | 'end',
    event: AnimationEvent<HTMLDivElement>,
  ) {
    if (event.target !== event.currentTarget) return;
    diagnostics?.('tree.branch.animation', {
      albumId,
      animationName: event.animationName,
      contentDepth,
      elapsedMs: event.elapsedTime * 1_000,
      itemCount,
      phase,
    });
  }

  useLayoutEffect(() => {
    if (!selection) return;
    if (selection.domainId && selection.typeId) {
      expansion.setPersistent(`dictionary-domain:${selection.domainId}`, true);
    }
    if (selection.domainId && selection.typeId && selection.termId) {
      const typeId = `dictionary-type:${selection.domainId}:${selection.typeId}`;
      expansion.setPersistent(typeId, true);
      const type = tree.domains
        .find((domain) => domain.domainId === selection.domainId)
        ?.types.find((candidate) => candidate.typeId === selection.typeId);
      const termIndex = type?.terms.findIndex((term) => term.term.id === selection.termId) ?? -1;
      if (termIndex >= 0) {
        setVisibleTermsByType((current) => {
          const visibleCount = Math.max(current[typeId] ?? pageSize, termIndex + 1);
          return current[typeId] === visibleCount ? current : { ...current, [typeId]: visibleCount };
        });
      }
    }
  }, [selection?.domainId, selection?.termId, selection?.typeId, tree]);

  function toggle(branchId: string) {
    if (expansion.isOpen(branchId)) expansion.collapse(branchId);
    else expansion.setPersistent(branchId, true);
  }

  function row(
    id: string,
    rowTitle: string,
    previewAssets: DictionaryMaterialTree['previewAssets'],
    expandable: boolean,
    active: boolean,
    icon: ReactNode,
    openCollection: GalleryDictionaryCollection,
    branchTopology?: TreeBranchItemTopology,
  ) {
    const open = expansion.isOpen(id);
    const handlers = click.handlers<HTMLButtonElement>(
      () => (expandable ? toggle(id) : onSelect(openCollection)),
      () => onSelect(openCollection),
    );
    const actions: ActionMenuAction[] = [
      { id: 'open', label: openLabel, icon: BookOpenIcon, onSelect: () => onSelect(openCollection) },
      ...(expandable
        ? [
            createAlbumExpansionAction({
              expanded: open,
              expandLabel,
              collapseLabel,
              onExpandedChange: (expanded) => expansion.setPersistent(id, expanded),
            }),
          ]
        : []),
    ];
    const content = (
      <div
        data-album-id={id}
        data-tree-node-id={id}
        className={cn(
          'group relative flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
          active &&
            'text-selected-foreground before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
        )}
      >
        <AlbumTreePreview
          assets={previewAssets}
          title={rowTitle}
          open={open}
          expandable={expandable}
          expandLabel={open ? collapseLabel : expandLabel}
          overlayStyle="solid"
          disclosureInteractive={false}
          branchTopology={branchTopology}
          onGestureExpand={() => expansion.expandFromGesture(id)}
          onPointerTrackStart={(clientY) => expansion.beginPointerTrack(id, clientY)}
          onPointerTrack={(clientY) => expansion.trackPointer(id, clientY)}
          onMediaAdmitted={
            diagnostics
              ? () =>
                  diagnostics('tree.media.admitted', {
                    albumId: id,
                    assetCount: previewAssets.length,
                    expandable,
                  })
              : undefined
          }
          onClick={handlers.onClick}
          onDoubleClick={handlers.onDoubleClick}
        />
        <Button
          type="button"
          variant="ghost"
          aria-pressed={active}
          className={cn(
            'z-10 h-10 min-w-0 flex-1 justify-start border-transparent px-1 font-normal focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-strong',
            active && 'bg-transparent hover:bg-transparent focus-visible:bg-transparent',
          )}
          {...handlers}
          onKeyDown={(event) => {
            if (!expandable) return;
            if (event.key === 'ArrowRight' && !open) {
              event.preventDefault();
              expansion.setPersistent(id, true);
            } else if (event.key === 'ArrowLeft' && open) {
              event.preventDefault();
              expansion.collapse(id);
            }
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm">
            <span className="grid size-4 shrink-0 place-items-center text-selected-foreground">{icon}</span>
            <span className="truncate" title={rowTitle}>
              {rowTitle}
            </span>
          </span>
        </Button>
        <ActionMenuButton
          actions={actions}
          label={moreActionsLabel(rowTitle)}
          className="absolute right-1 top-1/2 z-30 size-6 -translate-y-1/2 bg-overlay/95 opacity-0 shadow-overlay group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
        />
      </div>
    );
    return { content, actions, open };
  }

  function renderTerm(
    term: DictionaryMaterialTermNode,
    domainId: string,
    typeId: string,
    topology: TreeBranchItemTopology,
  ) {
    const openCollection: GalleryDictionaryCollection = {
      kind: 'dictionary',
      scope,
      domainId,
      typeId,
      termId: term.term.id,
    };
    const active = selection?.termId === term.term.id && selection.domainId === domainId && selection.typeId === typeId;
    const { content, actions } = row(
      term.id,
      term.title,
      term.previewAssets,
      false,
      active,
      <TagIcon className="size-3.5" />,
      openCollection,
      topology,
    );
    return (
      <div key={term.id} className="relative">
        <TreeBranchTransitRail topology={topology} />
        <ContextMenu>
          <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  }

  function renderType(type: DictionaryMaterialTypeNode, domainId: string, topology: TreeBranchItemTopology) {
    const id = branchKey(type);
    const openCollection: GalleryDictionaryCollection = { kind: 'dictionary', scope, domainId, typeId: type.typeId };
    const active = !selection?.termId && selection?.domainId === domainId && selection.typeId === type.typeId;
    const { content, actions, open } = row(
      id,
      type.title,
      type.previewAssets,
      type.terms.length > 0,
      active,
      <TagIcon className="size-3.5" />,
      openCollection,
      topology,
    );
    const visibleCount = Math.min(type.terms.length, visibleTermsByType[id] ?? pageSize);
    const visibleTerms = open ? type.terms.slice(0, visibleCount) : [];
    return (
      <Collapsible
        key={id}
        open={open}
        onOpenChange={(next) => expansion.setPersistent(id, next)}
        className="relative"
        data-album-branch-id={id}
        data-tree-branch-id={id}
      >
        <TreeBranchTransitRail topology={topology} />
        <ContextMenu>
          <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
        {open && type.terms.length > 0 && (
          <TreeBranchCollapseRail label={collapseLabel} onCollapse={() => expansion.collapse(id)} />
        )}
        {type.terms.length > 0 && (
          <TreeBranchContent
            onAnimationStart={(event) => traceBranchAnimation(id, 3, visibleTerms.length, 'start', event)}
            onAnimationEnd={(event) => traceBranchAnimation(id, 3, visibleTerms.length, 'end', event)}
          >
            <TreeBranchCollapseProvider onCollapse={() => expansion.collapse(id)}>
              {visibleTerms.map((term, index) =>
                renderTerm(
                  term,
                  domainId,
                  type.typeId,
                  getTreeBranchItemTopology(index, visibleTerms.length + Number(visibleCount < type.terms.length)),
                ),
              )}
              {open && visibleCount < type.terms.length && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-[5.5rem] h-8 px-2 text-xs text-muted-foreground"
                  onClick={() => setVisibleTermsByType((current) => ({ ...current, [id]: visibleCount + pageSize }))}
                >
                  {moreLabel}
                </Button>
              )}
            </TreeBranchCollapseProvider>
          </TreeBranchContent>
        )}
      </Collapsible>
    );
  }

  function renderDomain(domain: DictionaryMaterialDomainNode) {
    const id = branchKey(domain);
    const openCollection: GalleryDictionaryCollection = { kind: 'dictionary', scope, domainId: domain.domainId };
    const active = !selection?.typeId && selection?.domainId === domain.domainId;
    const { content, actions, open } = row(
      id,
      domain.title,
      domain.previewAssets,
      domain.types.length > 0,
      active,
      <ShapesIcon className="size-3.5" />,
      openCollection,
    );
    return (
      <Collapsible
        key={id}
        open={open}
        onOpenChange={(next) => expansion.setPersistent(id, next)}
        className="relative"
        data-album-branch-id={id}
        data-tree-branch-id={id}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
        {open && domain.types.length > 0 && (
          <TreeBranchCollapseRail label={collapseLabel} onCollapse={() => expansion.collapse(id)} />
        )}
        {domain.types.length > 0 && (
          <TreeBranchContent
            onAnimationStart={(event) => traceBranchAnimation(id, 2, domain.types.length, 'start', event)}
            onAnimationEnd={(event) => traceBranchAnimation(id, 2, domain.types.length, 'end', event)}
          >
            <TreeBranchCollapseProvider onCollapse={() => expansion.collapse(id)}>
              {open &&
                domain.types.map((type, index) =>
                  renderType(type, domain.domainId, getTreeBranchItemTopology(index, domain.types.length)),
                )}
            </TreeBranchCollapseProvider>
          </TreeBranchContent>
        )}
      </Collapsible>
    );
  }

  return <div data-material-system-album="DICTIONARY">{tree.domains.map((domain) => renderDomain(domain))}</div>;
}
