import { CheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ArticleDto, AssetDto, DerivedVisualAdoptInput, DerivedVisualDto } from '@/shared/contracts';
import { articleVisualPositionState } from '@/shared/derived-visual-media';
import { DerivedVisualPositionRelocation } from '@/renderer/components/creator/DerivedVisualPositionRelocation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { Button } from '@/renderer/components/ui/button';
import {
  useDerivedVisualOperations,
  type DerivedVisualOperationRunner,
} from '@/renderer/components/creator/useDerivedVisualOperations';
import { DerivedVisualOperationHistory } from '@/renderer/components/creator/DerivedVisualOperationHistory';

interface Props {
  spaceId: string;
  targetRevisionId: string | null;
  targetArticle: ArticleDto | null;
  visual: DerivedVisualDto;
  targetTitle?: string;
  currentAsset?: AssetDto | null;
  currentAssetId: string | null;
  candidateAssetId: string;
  runOperation: DerivedVisualOperationRunner;
  refresh(): Promise<void>;
}

export function DerivedVisualAdoptionBar({
  spaceId,
  targetRevisionId,
  targetArticle,
  visual,
  targetTitle,
  currentAsset,
  currentAssetId,
  candidateAssetId,
  runOperation,
  refresh,
}: Props) {
  const controller = useDerivedVisualOperations({
    spaceId,
    visualId: visual.id,
    targetRevisionId,
    run: runOperation,
    refresh,
  });
  const busy = controller.busy;
  const onAdopt = (intent: DerivedVisualAdoptInput['intent']) =>
    controller.adopt(candidateAssetId, intent, { imageAlt: labels.targetRoles.ARTICLE_INLINE });
  const labels = useI18n().messages.creator.derivedVisual;
  const inline = visual.role === 'ARTICLE_INLINE';
  const position = useMemo(
    () => (inline && targetArticle ? articleVisualPositionState(visual, targetArticle) : null),
    [inline, targetArticle, visual],
  );
  const positionBlocked = inline && (!position || position.status === 'MISSING' || position.status === 'AMBIGUOUS');
  const role = labels.targetRoles[visual.role];
  const action = inline
    ? currentAssetId
      ? labels.replaceIllustration
      : labels.insertIllustration
    : visual.role === 'ARTICLE_HEADER'
      ? labels.setHero
      : labels.setCover;
  const applied = currentAssetId === candidateAssetId;

  return (
    <div className="shrink-0 border-t border-border/60 bg-background p-2">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs text-foreground-secondary">
        {currentAsset && (
          <AssetThumbnail
            asset={currentAsset}
            size={96}
            alt={labels.currentImage}
            className="size-9 shrink-0 rounded border object-contain"
          />
        )}
        <span className="min-w-0 truncate" title={targetTitle}>
          {labels.applyTo(targetTitle || labels.sourceContent, role)}
        </span>
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={controller.blocked || applied || !targetRevisionId || positionBlocked}
        onClick={() => onAdopt(inline ? 'REPLACE_INLINE' : 'SET_COVER')}
      >
        {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
        {applied ? labels.currentlyUsed : action}
      </Button>
      {inline && position?.status === 'AMBIGUOUS' && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {labels.position.ambiguous}
        </p>
      )}
      {inline && position?.status === 'MISSING' && targetArticle && (
        <DerivedVisualPositionRelocation
          article={targetArticle}
          blocked={controller.blocked}
          onAdopt={(relocateAfterText, expectedRevisionId) =>
            controller.adopt(candidateAssetId, 'REPLACE_INLINE', {
              relocateAfterText,
              expectedRevisionId,
              imageAlt: labels.targetRoles.ARTICLE_INLINE,
            })
          }
        />
      )}
      {visual.role === 'SOCIAL_POST_COVER' && (
        <Button
          type="button"
          variant="ghost"
          className="mt-1 w-full"
          disabled={controller.blocked || !targetRevisionId}
          onClick={() => onAdopt('SET_COVER_AND_FIRST')}
        >
          {labels.setCoverAndFirst}
        </Button>
      )}
      <DerivedVisualOperationHistory controller={controller} />
    </div>
  );
}
