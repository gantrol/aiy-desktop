import type { BlockNode } from '@/shared/contracts/block-document';
import type { CreatorInputRecoverySnapshot } from '@/shared/contracts/creator-input-recovery';

function documentContent(node: BlockNode): BlockNode {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(([key, value]) => {
      if (value === null || value === undefined) return false;
      if (key === 'blockId' || key === 'articleElementId' || key === 'editorKey') return false;
      return !(
        (node.type === 'creatorTerm' || node.type === 'creatorRecipe') &&
        (key === 'label' || key === 'promptText')
      );
    }),
  );
  return {
    type: node.type,
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.marks?.length ? { marks: node.marks } : {}),
    ...(node.content?.length ? { content: node.content.map(documentContent) } : {}),
  };
}

/** Compare editable inputs, keeping the full snapshot (including block identities) for persistence and restore. */
export function creatorInputRecoverySnapshotKey(snapshot: CreatorInputRecoverySnapshot): string {
  return JSON.stringify(
    {
      // The block document is authoritative; legacy prompt fields are its derived projection when it exists.
      prompt: snapshot.document
        ? documentContent(snapshot.document.root)
        : { manualPrompt: snapshot.manualPrompt, promptNodes: snapshot.promptNodes },
      referenceAssetIds: snapshot.referenceAssetIds,
      videoMaterialIds: snapshot.videoMaterialIds ?? snapshot.videoAttachments?.map((video) => video.materialId) ?? [],
      termPromptLocale: snapshot.termPromptLocale,
      termIds: snapshot.termIds,
      wordPaletteReferences: snapshot.wordPaletteReferences,
      dictionaryScope: snapshot.dictionaryScope,
      canvasPresetKey: snapshot.canvasPresetKey,
      generationTargets: snapshot.generationTargets,
      // Series titles, resolved prompt text and media display metadata are not restored input edits.
    },
    (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
          )
        : value,
  );
}
