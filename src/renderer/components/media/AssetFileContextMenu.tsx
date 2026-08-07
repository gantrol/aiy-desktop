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
import { useRef, useState, type ReactNode } from 'react';
import type { AssetFileRevealContext, AssetFileRevealTargetDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AlbumTreeContextMenuItems } from '@/renderer/components/albums/AlbumTreeContextMenuItems';
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
  notify(message: string): void;
  actions?: readonly ActionMenuAction[];
  revealContext?: AssetFileRevealContext;
  copyable?: boolean;
  usableInCreation?: boolean;
}

type FileAction = 'COPY' | 'SAVE_AS' | 'REVEAL' | 'OPEN';

const defaultRevealContext: AssetFileRevealContext = { kind: 'ALL_MATERIALS' };

function AssetMenuIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <ContextMenuIcon>
      <Icon className={className} />
    </ContextMenuIcon>
  );
}

export function AssetFileContextMenu({
  assetId,
  children,
  notify,
  actions = [],
  revealContext = defaultRevealContext,
  copyable = true,
  usableInCreation = true,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.assetFile;
  const menuActions = useAssetMenuActions();
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
      {labels.reveal}
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
      {labels.reveal}
    </ContextMenuItem>
  ) : (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <AssetMenuIcon icon={FolderOpenIcon} />
        {labels.reveal}
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
            className="contents"
            data-asset-file-menu={assetId}
            data-file-action-state={fileActionBusy ?? 'IDLE'}
            aria-busy={fileActionBusy ? 'true' : undefined}
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
          {revealItem}
          <ContextMenuItem onSelect={() => void run('OPEN')}>
            <AssetMenuIcon icon={ExternalLinkIcon} />
            {labels.open}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <AssetMenuIcon icon={Trash2Icon} />
            {labels.delete}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteBusy) setDeleteOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.deleteTitle}</DialogTitle>
            <DialogDescription>{labels.deleteDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>
              {labels.cancel}
            </Button>
            <Button type="button" variant="destructive" disabled={deleteBusy} onClick={() => void deleteAsset()}>
              {deleteBusy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {labels.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
