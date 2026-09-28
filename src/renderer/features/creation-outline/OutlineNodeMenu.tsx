import {
  ArrowUpRightIcon,
  CheckIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderPlusIcon,
  LinkIcon,
  Maximize2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
} from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CreationOrganizationAction } from '@/renderer/features/creation-outline/CreationOrganizationAction';
import type { OutlineNode } from '@/renderer/features/creation-outline/outline-tree';
import {
  canSetOutlinePrimary,
  outlineNodeLinkTarget,
  type OutlineNodeActions,
} from '@/renderer/features/creation-outline/useOutlineNodeActions';

interface Props {
  node: OutlineNode | null;
  busy: boolean;
  actions: OutlineNodeActions;
  organization: { spaceId: string; refresh(): Promise<void>; onError(message: string): void };
  onOpen(): void;
  onFocus?(): void;
  onMove(): void;
  onOpenSource?(): void;
}

export function OutlineNodeMenu(props: Props) {
  const { node, organization } = props;
  if (node?.kind === 'content-action') return null;
  if (node?.target)
    return (
      <CreationOrganizationAction
        {...organization}
        target={{ kind: node.kind === 'album' ? 'album' : 'creation', id: node.target.id, title: node.title }}
        busy={props.busy}
        renderTrigger={(action) => (
          <OutlineNodeMenuTrigger {...props} busy={action.disabled} onOrganize={action.onClick} />
        )}
      />
    );
  return <OutlineNodeMenuTrigger {...props} />;
}

function OutlineNodeMenuTrigger({
  node,
  busy,
  actions,
  onOpen,
  onFocus,
  onMove,
  onOpenSource,
  onOrganize,
}: Props & { onOrganize?(): void }) {
  const { messages } = useI18n();
  const labels = messages.creator.outline;
  const albumLabels = messages.creator.album;
  const container = !node || node.kind === 'album';
  const opening = useRef(false);
  const openSurface = (action: () => void) => {
    opening.current = true;
    action();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={albumLabels.moreActions}
          title={albumLabels.moreActions}
        >
          <MoreHorizontalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (opening.current) event.preventDefault();
          opening.current = false;
        }}
      >
        {node && (
          <>
            <DropdownMenuItem onSelect={() => openSurface(onOpen)}>
              <ArrowUpRightIcon />
              {node.content ? labels.editContent : labels.open}
            </DropdownMenuItem>
            {node.children.length > 0 && onFocus && (
              <DropdownMenuItem onSelect={onFocus}>
                <Maximize2Icon />
                {labels.focus}
              </DropdownMenuItem>
            )}
          </>
        )}
        {container && (
          <>
            <DropdownMenuItem onSelect={() => openSurface(() => actions.newCreation(node?.target?.id ?? null))}>
              <PlusIcon />
              {labels.newCreation}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSurface(() => actions.newAlbum(node))}>
              <FolderPlusIcon />
              {node ? messages.gallery.albums.createChild : albumLabels.newAlbum}
            </DropdownMenuItem>
          </>
        )}
        {onOrganize && (
          <DropdownMenuItem onSelect={() => openSurface(onOrganize)}>
            {node?.kind === 'album' ? <FileTextIcon /> : <PlusIcon />}
            {node?.kind === 'album' ? labels.albumNote : labels.createChild}
          </DropdownMenuItem>
        )}
        {node?.target && (
          <>
            <DropdownMenuSeparator />
            {node.kind === 'album' && (
              <DropdownMenuItem onSelect={() => openSurface(() => actions.rename(node))}>
                <PencilIcon />
                {albumLabels.rename}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => openSurface(onMove)}>
              <FolderInputIcon />
              {labels.move}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.togglePin(node)}>
              {node.libraryEntry?.pinned ? <PinOffIcon /> : <PinIcon />}
              {node.libraryEntry?.pinned ? albumLabels.unpin : albumLabels.pin}
            </DropdownMenuItem>
          </>
        )}
        {node && canSetOutlinePrimary(node) && (
          <DropdownMenuItem disabled={node.primary} onSelect={() => actions.setPrimary(node)}>
            <CheckIcon />
            {node.primary ? labels.primaryWork : labels.setPrimary}
          </DropdownMenuItem>
        )}
        {node && outlineNodeLinkTarget(node) && (
          <DropdownMenuItem onSelect={() => actions.copyLink(node)}>
            <LinkIcon />
            {labels.copyLink}
          </DropdownMenuItem>
        )}
        {onOpenSource && (
          <DropdownMenuItem onSelect={() => openSurface(onOpenSource)}>
            <LinkIcon />
            {labels.openSource}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
