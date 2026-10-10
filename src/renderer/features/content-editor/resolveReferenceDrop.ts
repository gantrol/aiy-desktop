import type { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import type { BlockNode } from '@/shared/contracts/block-document';
import type { ContentSource, ReferenceTarget } from '@/shared/contracts/content-source';
import { followingPresentation } from '@/shared/content-reference-token';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';

export interface ReferenceDropContext {
  source?: ContentSource;
  sessions?: ReturnType<typeof useArticleEditorSessions>;
}

function preparedTarget(item: ReferenceTarget, prepared: ContentSource | null | undefined): ReferenceTarget {
  if (!prepared) return item;
  if (prepared.kind !== item.source.kind || prepared.id !== item.source.id) throw new Error('REFERENCE_TARGET_CHANGED');
  return { ...item, source: prepared };
}

async function inspectDroppedBody(target: ReferenceTarget, assertCurrent: () => void) {
  const preview = await contentLibraryApi().referenceInspect(target);
  assertCurrent();
  if (target.source.kind === 'CREATION_ITEM' && preview.selector?.kind === 'MEMBERS') {
    const members = preview.selector.members;
    const articles = members.filter((member) => member.kind === 'ARTICLE');
    const body = articles.length === 1 ? articles[0] : members.length === 1 ? members[0] : undefined;
    if (body && (body.kind === 'ARTICLE' || body.kind === 'SOCIAL_POST' || body.kind === 'VIDEO_DOCUMENT')) {
      const bodyTarget: ReferenceTarget = { source: { kind: body.kind, id: body.id } };
      return { target: bodyTarget, preview, resolvedBody: true };
    }
  }
  return { target, preview, resolvedBody: false };
}

/** Both editor surfaces resolve sidebar works to the same saved body before inserting anything. */
export async function resolveReferenceDrop(
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>,
  assertCurrent: () => void,
  { source, sessions }: ReferenceDropContext = {},
): Promise<BlockNode[]> {
  assertCurrent();
  const prepared = await payload.prepare?.();
  assertCurrent();
  if (payload.prepare && !prepared) throw new Error('REFERENCE_SAVE_FAILED');
  const api = contentLibraryApi();
  const nodes: BlockNode[] = [];
  for (const item of payload.targets) {
    let target = preparedTarget(item, prepared);
    if (payload.mode === 'FOLLOW') {
      if (target.source.kind !== 'ARTICLE' || target.source.branchId || target.source.noteId)
        throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
      target = { ...target, source: { kind: 'ARTICLE', id: target.source.id } };
    }
    const inspected = await inspectDroppedBody(target, assertCurrent);
    target = inspected.target;
    let preview = inspected.preview;
    const following = target.source.kind === 'ARTICLE';
    if (target.source.kind === 'ARTICLE') {
      if (target.source.branchId || target.source.noteId) throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
      if (source?.kind === 'ARTICLE' && source.id === target.source.id && !target.blockId)
        throw new Error('REFERENCE_FOLLOW_NESTED');
      target = { ...target, source: { kind: 'ARTICLE', id: target.source.id } };
      const existing = preview.spaceId ? sessions?.find(preview.spaceId, target.source.id) : undefined;
      if (existing) {
        const saved = await existing.flush('manual');
        assertCurrent();
        if (!saved) throw new Error('REFERENCE_SAVE_FAILED');
      }
    }
    if (following || inspected.resolvedBody) {
      const spaceId = preview.spaceId;
      preview = await api.referenceInspect(target);
      assertCurrent();
      if (preview.spaceId !== spaceId) throw new Error('REFERENCE_TARGET_CHANGED');
    }
    const reference = following
      ? await api.referenceFollow(preview.target, preview.version)
      : await api.referenceCapture(preview.target, preview.version, preview.resolutionId);
    assertCurrent();
    if (preview.spaceId !== reference.spaceId) throw new Error('REFERENCE_TARGET_CHANGED');
    nodes.push({
      type: 'contentReference',
      attrs: {
        blockId: crypto.randomUUID(),
        referenceId: reference.id,
        referenceSpaceId: reference.spaceId ?? null,
        referencePresentation: following ? followingPresentation : null,
        referenceEditing: 'READ_ONLY',
      },
    });
  }
  return nodes;
}
