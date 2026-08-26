import {
  BookOpenIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  ImagesIcon,
  LoaderCircleIcon,
  SquarePenIcon,
  Trash2Icon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import type { AssetFileRevealContext, AssetFileRevealTargetDto } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/catalog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AlbumTreeContextMenuItems } from '@/renderer/components/albums/AlbumTreeContextMenuItems';
import { startImageAssetDrag } from '@/renderer/components/albums/albumDrag';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuIcon,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { ActionContextMenuItems, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { useAssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';

interface Props {
  assetId: string;
  children: ReactNode;
  notify?(message: string): void;
  actions?: readonly ActionMenuAction[];
  lifecycleActions?: readonly ActionMenuAction[];
  revealContext?: AssetFileRevealContext;
  copyable?: boolean;
  usableInCreation?: boolean;
  draggable?: boolean;
}

type FileAction = 'COPY' | 'SAVE_AS' | 'REVEAL' | 'REVEAL_SOURCE' | 'OPEN';

const defaultRevealContext: AssetFileRevealContext = { kind: 'ALL_MATERIALS' };

function useDraggableFirstChild(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const dragTarget = containerRef.current?.firstElementChild;
    if (!(dragTarget instanceof HTMLElement) || dragTarget.hasAttribute('draggable')) return;
    dragTarget.draggable = true;
    return () => dragTarget.removeAttribute('draggable');
  });
  return containerRef;
}

function AssetMenuIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <ContextMenuIcon>
      <Icon className={className} />
    </ContextMenuIcon>
  );
}

function DeleteAssetDialog({
  open,
  busy,
  labels,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  busy: boolean;
  labels: MessageCatalog['assetFile'];
  onOpenChange(open: boolean): void;
  onDelete(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.deleteTitle}</DialogTitle>
          <DialogDescription>{labels.deleteDescription}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onDelete}>
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {labels.confirmDelete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function startNativeFileDrag(
  event: ReactDragEvent<HTMLDivElement>,
  assetId: string,
  enabled: boolean,
  failedLabel: string,
  notify: (message: string) => void,
) {
  if (!enabled) return;
  const request = startImageAssetDrag(event, [assetId]);
  if (request) {
    void request.catch((reason) => {
      notify(`${failedLabel}: ${reason instanceof Error ? reason.message : String(reason)}`);
    });
  }
}

export function AssetFileContextMenu({
  assetId,
  children,
  notify: notifyProp,
  actions = [],
  lifecycleActions,
  revealContext = defaultRevealContext,
  copyable = true,
  usableInCreation = true,
  draggable = copyable,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.assetFile;
  const menuActions = useAssetMenuActions();
  const notify = notifyProp ?? menuActions?.notify ?? (() => undefined);
  const dragSurfaceRef = useDraggableFirstChild(draggable);
  const revealRequestKey = `${assetId}:${JSON.stringify(revealContext)}`;
  const latestRevealRequestKey = useRef(revealRequestKey);
  const revealRequestRevision = useRef(0);
  const [revealTargetState, setRevealTargetState] = useState<{
    key: string;
    targets: AssetFileRevealTargetDto[];
  } | null>(null);
  const [revealTargetsLoadingKey, setRevealTargetsLoadingKey] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [fileActionBusy, setFileActionBusy] = useState<FileAction | null>(null);
  latestRevealRequestKey.current = revealRequestKey;
  const revealTargets = revealTargetState?.key === revealRequestKey ? revealTargetState.targets : null;
  const revealTargetsLoading = revealTargetsLoadingKey === revealRequestKey;

  async function run(action: FileAction, context = revealContext) {
    if (fileActionBusy) return;
    setFileActionBusy(action);
    try {
      if (action === 'COPY') {
        notify(labels.copying);
        await window.desktopApi.assetFileCopy(assetId);
        notify(labels.copied);
      } else if (action === 'SAVE_AS') {
        const result = await window.desktopApi.assetFileSaveAs(assetId);
        if (result.status === 'saved') notify(labels.saved);
      } else if (action === 'REVEAL_SOURCE') {
        await window.desktopApi.assetFileReveal(assetId);
      } else if (action === 'REVEAL') {
        await window.desktopApi.assetFileReveal(assetId, context);
      } else {
        await window.desktopApi.assetFileOpen(assetId);
      }
    } catch (reason) {
      notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setFileActionBusy(null);
    }
  }

  async function addToAlbum(albumId: string, title: string) {
    try {
      await window.desktopApi.materialsAddToDestinations({
        targets: [{ kind: 'IMAGE_ASSET', imageAssetId: assetId }],
        albumIds: [albumId],
        termIds: [],
      });
      notify(`${labels.addedToAlbum} · ${title}`);
      await menuActions?.refreshLibrary();
    } catch (reason) {
      notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  async function sendToCreation() {
    if (!menuActions) return;
    try {
      await menuActions.useInCreation(assetId);
      notify(labels.addedToCreation);
    } catch (reason) {
      notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  async function deleteAsset() {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      await window.desktopApi.assetDelete(assetId);
      setDeleteOpen(false);
      notify(labels.deleted);
      await menuActions?.refreshLibrary();
    } catch (reason) {
      notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setDeleteBusy(false);
    }
  }

  const aggregateRevealContext = revealContext.kind === 'ALL_MATERIALS' || revealContext.kind === 'DICTIONARY';

  function loadRevealTargets() {
    if (!aggregateRevealContext || revealTargetsLoading) return;
    const requestKey = revealRequestKey;
    const revision = ++revealRequestRevision.current;
    setRevealTargetState(null);
    setRevealTargetsLoadingKey(requestKey);
    void window.desktopApi
      .assetFileRevealTargets(assetId, revealContext)
      .then((targets) => {
        if (latestRevealRequestKey.current === requestKey && revealRequestRevision.current === revision) {
          setRevealTargetState({ key: requestKey, targets });
        }
      })
      .catch((reason) => {
        if (latestRevealRequestKey.current !== requestKey || revealRequestRevision.current !== revision) return;
        setRevealTargetState({ key: requestKey, targets: [] });
        notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => {
        if (latestRevealRequestKey.current === requestKey && revealRequestRevision.current === revision) {
          setRevealTargetsLoadingKey(null);
        }
      });
  }

  const revealItem = !aggregateRevealContext ? (
    <ContextMenuItem onSelect={() => void run('REVEAL')}>
      <AssetMenuIcon icon={FolderOpenIcon} />
      {labels.revealPlacement}
    </ContextMenuItem>
  ) : revealTargetsLoading || revealTargets === null ? (
    <ContextMenuItem disabled>
      <AssetMenuIcon icon={LoaderCircleIcon} className="animate-spin" />
      {labels.locating}
    </ContextMenuItem>
  ) : revealTargets.length === 0 ? (
    <ContextMenuItem disabled>
      <AssetMenuIcon icon={FolderOpenIcon} />
      {revealContext.kind === 'DICTIONARY' ? labels.notInTerm : labels.notInAlbumOrTerm}
    </ContextMenuItem>
  ) : revealTargets.length === 1 ? (
    <ContextMenuItem onSelect={() => void run('REVEAL', revealTargets[0].context)}>
      <AssetMenuIcon icon={FolderOpenIcon} />
      {labels.revealPlacement}
    </ContextMenuItem>
  ) : (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <AssetMenuIcon icon={FolderOpenIcon} />
        {labels.revealPlacement}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {revealTargets.map((target) => (
          <ContextMenuItem
            key={target.context.kind === 'ALBUM' ? `album:${target.context.albumId}` : `term:${target.context.termId}`}
            title={target.relativeDirectory}
            onSelect={() => void run('REVEAL', target.context)}
          >
            <ContextMenuIcon>{target.context.kind === 'ALBUM' ? <ImagesIcon /> : <BookOpenIcon />}</ContextMenuIcon>
            <span className="max-w-80 truncate">{target.relativeDirectory}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );

  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          if (open) loadRevealTargets();
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            ref={dragSurfaceRef}
            className="contents"
            data-asset-file-menu={assetId}
            data-native-file-drag={draggable ? 'true' : undefined}
            data-file-action-state={fileActionBusy ?? 'IDLE'}
            aria-busy={fileActionBusy ? 'true' : undefined}
            draggable={draggable}
            onDragStart={(event) => startNativeFileDrag(event, assetId, draggable, labels.failed, notify)}
          >
            {children}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {actions.length > 0 && (
            <>
              <ActionContextMenuItems actions={actions} />
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            data-action="asset-file-copy"
            disabled={Boolean(fileActionBusy) || !copyable}
            onSelect={() => void run('COPY')}
          >
            <AssetMenuIcon
              icon={fileActionBusy === 'COPY' ? LoaderCircleIcon : CopyIcon}
              className={fileActionBusy === 'COPY' ? 'animate-spin' : undefined}
            />
            {labels.copy}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <AssetMenuIcon icon={FolderPlusIcon} />
              {labels.addToAlbum}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-80 min-w-52 overflow-y-auto">
              <AlbumTreeContextMenuItems
                albums={menuActions?.albums ?? []}
                currentAlbumLabel={labels.addToCurrentAlbum}
                emptyLabel={labels.noAlbums}
                onSelect={(album) => void addToAlbum(album.id, album.title)}
              />
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem disabled={!menuActions || !usableInCreation} onSelect={() => void sendToCreation()}>
            <AssetMenuIcon icon={SquarePenIcon} />
            {labels.useInCreation}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void run('SAVE_AS')}>
            <AssetMenuIcon icon={DownloadIcon} />
            {labels.saveAs}
          </ContextMenuItem>
          <ContextMenuItem data-action="asset-file-reveal-source" onSelect={() => void run('REVEAL_SOURCE')}>
            <AssetMenuIcon icon={FolderOpenIcon} />
            {labels.reveal}
          </ContextMenuItem>
          {revealItem}
          <ContextMenuItem onSelect={() => void run('OPEN')}>
            <AssetMenuIcon icon={ExternalLinkIcon} />
            {labels.open}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {lifecycleActions === undefined ? (
            <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <AssetMenuIcon icon={Trash2Icon} />
              {labels.delete}
            </ContextMenuItem>
          ) : (
            <ActionContextMenuItems actions={lifecycleActions} />
          )}
        </ContextMenuContent>
      </ContextMenu>
      <DeleteAssetDialog
        open={lifecycleActions === undefined && deleteOpen}
        busy={deleteBusy}
        labels={labels}
        onOpenChange={setDeleteOpen}
        onDelete={() => void deleteAsset()}
      />
    </>
  );
}
