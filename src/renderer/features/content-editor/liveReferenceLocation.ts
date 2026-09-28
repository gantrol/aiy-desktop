import type { ArticleEditorSessionRuntime } from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import type { ReferenceTarget } from '@/shared/contracts/content-source';
import type { BlockNode } from '@/shared/contracts/block-document';

/** Resolve against the existing draft without capturing, saving, or replacing that draft. */
export function liveReferenceLocation(
  runtime: ArticleEditorSessionRuntime,
  target: ReferenceTarget,
  referenceId?: string,
) {
  if (runtime.getRecoveryPending() || runtime.model.getSnapshot().editorPending)
    throw new Error('REFERENCE_TARGET_CHANGED');
  if (!target.blockId && !referenceId) return null;
  const root = runtime.getDocumentProjection()?.root;
  if (!root) throw new Error('REFERENCE_LOCATION_MISSING');
  const matches: BlockNode[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      target.blockId
        ? node.attrs?.blockId === target.blockId
        : node.type === 'contentReference' && node.attrs?.referenceId === referenceId
    )
      matches.push(node);
    pending.push(...(node.content ?? []));
  }
  if (matches.length !== 1 || typeof matches[0].attrs?.blockId !== 'string')
    throw new Error('REFERENCE_LOCATION_MISSING');
  if (referenceId && (matches[0].type !== 'contentReference' || matches[0].attrs?.referenceId !== referenceId))
    throw new Error('REFERENCE_USE_CHANGED');
  return matches[0].attrs.blockId as string;
}
