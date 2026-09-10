import { useMemo, useState } from 'react';
import { FolderIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  canMoveOutlineTo,
  outlineAncestors,
  outlineRows,
  type OutlineNode,
  type OutlineTree,
} from '@/renderer/features/creation-outline/outline-tree';

interface Props {
  tree: OutlineTree;
  selection: readonly OutlineNode[];
  busy: boolean;
  error: string;
  onClose(): void;
  onMove(albumId: string | null): Promise<void>;
}
export function OutlineMoveDialog({ tree, selection, busy, error, onClose, onMove }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.outline;
  const [query, setQuery] = useState('');
  const [destination, setDestination] = useState<string | null | undefined>();
  const allRows = useMemo(() => outlineRows(tree, null, new Set(tree.nodes.keys()), ''), [tree]);
  const destinations = allRows
    .filter(({ node }) => node.kind === 'album')
    .map(({ node, depth }) => ({
      node,
      depth,
      path: [...outlineAncestors(tree, node.key), node].map((ancestor) => ancestor.title).join(' / '),
    }))
    .filter(({ path }) => path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-md gap-3 rounded-md"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels.moveSelection(selection.length)}</DialogTitle>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.findAlbum}
          aria-label={labels.findAlbum}
        />
        <ScrollArea className="h-72 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <Button
            variant={destination === null ? 'secondary' : 'ghost'}
            className="w-full justify-start rounded-none"
            disabled={busy || !canMoveOutlineTo(tree, selection, null)}
            onClick={() => setDestination(null)}
          >
            <FolderIcon className="size-4" />
            {labels.topLevel}
          </Button>
          {destinations.map(({ node, depth, path }) => (
            <Button
              key={node.key}
              variant={destination === node.target!.id ? 'secondary' : 'ghost'}
              className="w-full justify-start rounded-none"
              style={{ paddingLeft: 12 + Math.min(depth, 8) * 16 }}
              title={path}
              disabled={busy || !canMoveOutlineTo(tree, selection, node.target!.id)}
              onClick={() => setDestination(node.target!.id)}
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="truncate">{node.title}</span>
            </Button>
          ))}
        </ScrollArea>
        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {messages.common.cancel}
          </Button>
          <Button
            disabled={busy || destination === undefined || !canMoveOutlineTo(tree, selection, destination)}
            onClick={() => {
              if (destination !== undefined) void onMove(destination);
            }}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {labels.move}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
