import type { ContentReference } from '@/shared/contracts/content-library';
import type { ReferencePresentation } from '@/shared/content-reference-token';
import { useFollowingSource } from '@/renderer/features/content-editor/useFollowingSource';
import { referenceDocumentSelection } from '@/renderer/features/content-editor/referenceDocumentEditing';
import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { presentReferenceDocument } from '@/shared/content-reference-document';
import { ContentReferenceBody } from '@/renderer/features/content-editor/ContentReferenceBody';
import { useI18n } from '@/renderer/i18n/useI18n';
import { referenceFailure } from '@/shared/i18n/reference-outline';

/** Read the shared draft without attaching an editable view or publishing changes. */
export function FollowingReferenceBody({
  reference,
  presentation,
  parentLevel,
  originBlockId,
}: {
  reference: ContentReference;
  presentation?: ReferencePresentation;
  parentLevel: number;
  originBlockId: string;
}) {
  const { runtime, failure } = useFollowingSource(reference);
  const copy = useI18n().messages.referenceOutline;
  let document = reference.document;
  let media = reference.media;
  let error = failure;
  try {
    if (runtime) {
      const snapshot = runtime.captureSnapshot();
      document = referenceDocumentSelection(
        snapshot.document ?? markdownBlockDocument(snapshot.markdown, snapshot.mediaBindings),
        reference.selector,
        snapshot.editorMode === 'OUTLINE',
      );
      const assets = new Map(runtime.model.getSnapshot().draft.media.map((asset) => [asset.assetId, asset]));
      media = snapshot.mediaBindings.flatMap((binding) => {
        const asset = assets.get(binding.assetId);
        return asset ? [{ ...asset, path: binding.path }] : [];
      });
    }
    document = presentReferenceDocument(
      { ...reference, document },
      presentation ? { ...presentation, display: 'BODY' } : undefined,
      parentLevel,
    );
  } catch (reason) {
    error = String(reason);
  }
  return (
    <>
      <ContentReferenceBody
        document={document}
        markdown={reference.markdown}
        media={media}
        originBlockId={originBlockId}
        source={reference.source}
        typography={presentation?.display === 'BODY' ? 'article' : 'compact'}
      />
      {error && (
        <span role="status" className="text-xs text-warning">
          {referenceFailure(error, copy)}
        </span>
      )}
    </>
  );
}
