import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ArticleEditorLocationDto, ContentCommentDto } from '@/shared/contracts';
import {
  liveContentCommentAnchor,
  mapContentCommentTextRange,
} from '@/renderer/features/content-editor/contentCommentAnchors';
import type {
  ArticleElementPluginState,
  LocatedArticleElementIndex,
} from '@/renderer/features/video-documents/articleElementIdentity';

interface RemapHelpers {
  indexOf(document: ProseMirrorNode): LocatedArticleElementIndex;
  locationAt(
    document: ProseMirrorNode,
    index: LocatedArticleElementIndex,
    position: number,
  ): ArticleEditorLocationDto | null;
  attributes(comment: ContentCommentDto, relocated: boolean): Record<string, string>;
  fallback(
    document: ProseMirrorNode,
    index: LocatedArticleElementIndex,
    comment: ContentCommentDto,
    forceRelocated: boolean,
  ): Decoration[];
}

/** A structural move retains live comment offsets by stable element identity. */
export function remapOutlineStructureComments(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  current: ArticleElementPluginState,
  comments: readonly ContentCommentDto[],
  helpers: RemapHelpers,
): ArticleElementPluginState {
  const index = helpers.indexOf(after);
  const decorations: Decoration[] = [];
  const decorationByCommentId = new Map<string, Decoration>();
  const resolutionByCommentId = new Map<string, ContentCommentDto['targetResolution']>();
  for (const comment of comments) {
    if (comment.anchor.kind !== 'TEXT_RANGE') {
      // BLOCK means the item's own body. Keep every body segment attached to the
      // item identity instead of resolving the first segment's parent position.
      const resolved = helpers.fallback(after, index, comment, false);
      if (resolved.length) {
        decorations.push(...resolved);
        decorationByCommentId.set(comment.id, resolved[0]!);
      }
      resolutionByCommentId.set(comment.id, resolved.length ? 'AVAILABLE' : 'MISSING');
      continue;
    }
    const oldDecoration = current.decorationByCommentId.get(comment.id);
    const range = mapContentCommentTextRange(before, after, comment, oldDecoration);
    let decoration: Decoration | undefined;
    if (range) {
      const attributes = helpers.attributes(comment, false);
      const specification = { commentId: comment.id, relocated: false };
      decoration = Decoration.inline(range.from, range.to, attributes, specification);
    }
    const live = liveContentCommentAnchor(before, comment, oldDecoration, (position) =>
      helpers.locationAt(before, current.index, position),
    );
    const resolved = decoration ? [decoration] : helpers.fallback(after, index, live ?? comment, range !== undefined);
    decoration = resolved[0];
    if (decoration) {
      decorations.push(...resolved);
      decorationByCommentId.set(comment.id, decoration);
    }
    resolutionByCommentId.set(
      comment.id,
      decoration ? (decoration.spec.relocated ? 'RELOCATED' : 'AVAILABLE') : 'MISSING',
    );
  }
  return {
    index,
    decorations: DecorationSet.create(after, decorations),
    decorationByCommentId,
    resolutionByCommentId,
    hasElements: index.elements.length > 0,
  };
}
