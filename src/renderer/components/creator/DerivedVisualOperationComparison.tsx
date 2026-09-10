import { useEffect, useState } from 'react';
import type { AssetDto } from '@/shared/contracts';
import type { DerivedVisualRevisionSnapshot } from '@/shared/contracts/derived-visual-operations';
import type { useDerivedVisualOperations } from '@/renderer/components/creator/useDerivedVisualOperations';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';

function RevisionPreview({ snapshot, label }: { snapshot: DerivedVisualRevisionSnapshot | null; label: string }) {
  const copy = useI18n().messages.creator.derivedVisual.adoption;
  if (!snapshot)
    return (
      <section className="min-w-0 rounded border p-3">
        <strong>{label}</strong>
        <p className="mt-3 text-muted-foreground">{copy.revisionUnavailable}</p>
      </section>
    );
  const revision = snapshot.kind === 'ARTICLE' ? snapshot.revision : snapshot.post;
  const content = revision.content;
  const body = 'markdown' in content ? content.markdown : content.body;
  const ids =
    'mediaBindings' in content ? content.mediaBindings.map((binding) => binding.assetId) : content.mediaAssetIds;
  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-3 rounded border p-3">
      <h3 className="font-medium">
        {label} · {copy.revision.replace('{revision}', String(revision.revisionNo))}
      </h3>
      <strong className="break-words">{content.title}</strong>
      <div className="min-h-20 flex-1 overflow-auto whitespace-pre-wrap break-words text-sm">{body}</div>
      <div className="flex max-h-36 shrink-0 flex-wrap gap-2 overflow-auto">
        {ids.map((id, index) => {
          const asset = content.mediaAssets.find((item) => item.id === id);
          return (
            <figure key={`${id}:${index}`} className="w-20 text-xs">
              {asset ? (
                <AssetThumbnail
                  asset={asset}
                  size={192}
                  alt={String(index + 1)}
                  loading="lazy"
                  className="size-20 rounded border object-contain"
                />
              ) : (
                <div className="grid size-20 place-items-center">{copy.imageUnavailable}</div>
              )}
              <figcaption>
                {index + 1}
                {content.coverAssetId === id ? ` · ${copy.cover}` : ''}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

export function DerivedVisualOperationComparison({
  controller,
}: {
  controller: ReturnType<typeof useDerivedVisualOperations>;
}) {
  const copy = useI18n().messages.creator.derivedVisual.adoption;
  const details = controller.details;
  const request = details?.operation.request;
  const imageAssetId = request?.kind === 'ADOPT' ? request.imageAssetId : null;
  const [candidate, setCandidate] = useState<AssetDto | null>(null);
  useEffect(() => {
    setCandidate(null);
    if (!imageAssetId) return;
    let current = true;
    void window.desktopApi
      .materialImageAssetsResolve({ targets: [{ kind: 'IMAGE_ASSET', imageAssetId }] })
      .then((assets) => {
        if (current) setCandidate(assets[0] ?? null);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [imageAssetId]);
  const conflict = details?.operation.status === 'CONFLICT';
  return (
    <Dialog
      open={Boolean(details) || controller.detailLoading}
      onOpenChange={(open) => {
        if (!open) controller.closeDetails();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{copy.compare}</DialogTitle>
          <DialogDescription>
            {conflict
              ? request?.kind === 'UNDO'
                ? copy.undoConflict
                : details?.operation.conflictReason === 'VISUAL_CHANGED'
                  ? copy.positionConflict
                  : copy.conflict
              : copy.comparisonHelp}
          </DialogDescription>
        </DialogHeader>
        {controller.detailLoading ? (
          <p role="status">{copy.loading}</p>
        ) : (
          details && (
            <>
              {request?.kind === 'ADOPT' && (
                <div className="flex shrink-0 items-center gap-3 rounded border p-2">
                  {candidate ? (
                    <AssetThumbnail
                      asset={candidate}
                      size={192}
                      alt={copy.candidate}
                      className="size-16 object-contain"
                    />
                  ) : (
                    <span className="text-muted-foreground">{copy.imageUnavailable}</span>
                  )}
                  <span>
                    {copy.candidate} · {copy.intents[request.intent]}
                  </span>
                </div>
              )}
              <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
                <RevisionPreview label={copy.before} snapshot={details.before} />
                <RevisionPreview
                  label={conflict ? copy.observed : copy.after}
                  snapshot={conflict ? details.observed : details.after}
                />
              </div>
              {conflict && request?.kind === 'ADOPT' && details.operation.conflictReason !== 'VISUAL_CHANGED' && (
                <Button
                  disabled={controller.blocked || !details.observed}
                  onClick={() => controller.adoptReviewed(details.operation)}
                >
                  {copy.applyReviewed}
                </Button>
              )}
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
