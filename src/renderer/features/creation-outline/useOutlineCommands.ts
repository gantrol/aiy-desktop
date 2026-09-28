import { useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  CREATION_OUTLINE_BATCH_LIMIT,
  type CreationOutlineCommand,
  type CreationOutlineResult,
} from '@/shared/contracts/creation-outline';
import {
  canMoveOutlineTo,
  type OutlineNode,
  type OutlineTree,
} from '@/renderer/features/creation-outline/outline-tree';

/** One move/copy/undo lifecycle for the dialog, toolbar and drop targets. */
export function useOutlineCommands({
  tree,
  busy,
  onCommand,
  onSuccess,
  onError,
}: {
  tree: OutlineTree;
  busy: boolean;
  onCommand(command: CreationOutlineCommand): Promise<CreationOutlineResult>;
  onSuccess(): void;
  onError(message: string): void;
}) {
  const labels = useI18n().messages.creator.outline;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const locked = busy || pending;

  async function execute(command: CreationOutlineCommand) {
    if (locked || pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    onError('');
    setStatus('');
    try {
      const result = await onCommand(command);
      if (result.kind === 'error') {
        onError(labels.errors[result.code]);
        return false;
      }
      if (result.kind === 'undone' || result.count > 0) setUndoToken(result.kind === 'moved' ? result.undoToken : null);
      setStatus(
        result.kind === 'moved'
          ? labels.moved(result.count)
          : result.kind === 'copied'
            ? labels.copied(result.count)
            : labels.undone,
      );
      onSuccess();
      return true;
    } catch {
      onError(labels.errors.FAILED);
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function move(
    nodes: readonly OutlineNode[],
    albumId: string | null,
    copy = false,
    parentCreationItemId: string | null = null,
  ) {
    if (
      !canMoveOutlineTo(tree, nodes, albumId, copy, parentCreationItemId) ||
      nodes.length > CREATION_OUTLINE_BATCH_LIMIT
    )
      return;
    if (
      await execute({
        kind: copy ? 'copy' : 'move',
        targets: nodes.flatMap((node) => (node.target ? [node.target] : [])),
        albumId,
        ...(!copy ? { parentCreationItemId } : {}),
      })
    )
      setMoveOpen(false);
  }

  return { pending, locked, moveOpen, setMoveOpen, undoToken, status, execute, move };
}
