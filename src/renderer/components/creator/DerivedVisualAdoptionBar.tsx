import { CheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { prepareArticleCoverAdoption } from '@/renderer/components/creator/article-editor/prepareArticleCoverAdoption';
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
  candidateAsset?: AssetDto;
  runOperation: DerivedVisualOperationRunner;
  refresh(): Promise<void>;
}

function isAppliedCandidate({
  visual,
  currentAssetId,
  candidateAssetId,
  targetArticle,
}: Pick<Props, 'visual' | 'currentAssetId' | 'candidateAssetId' | 'targetArticle'>) {
  return (
    currentAssetId === candidateAssetId ||
    Boolean(
      visual.coverRatio &&
      targetArticle?.content.coverVariants?.some(
        (cover) => cover.ratio === visual.coverRatio && cover.sourceAssetId === candidateAssetId,
      ),
    )
  );
}

function usePreparedVisualAdoption({
  visual,
  candidateAssetId,
  candidateAsset,
  targetRevisionId,
  controller,
}: Pick<Props, 'visual' | 'candidateAssetId' | 'candidateAsset' | 'targetRevisionId'> & {
  controller: ReturnType<typeof useDerivedVisualOperations>;
}) {
  const imageAlt = useI18n().messages.creator.derivedVisual.targetRoles.ARTICLE_INLINE;
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState(false);
  const preparingRef = useRef(false);
  const active = useRef<string | null>(null);
  const candidateIdentity = `${visual.id}:${candidateAssetId}`;
  useLayoutEffect(() => {
    active.current = candidateIdentity;
    return () => {
      active.current = null;
    };
  }, [candidateIdentity]);
  async function onAdopt(intent: DerivedVisualAdoptInput['intent']) {
    if (controller.blocked || preparingRef.current || !targetRevisionId) return;
    preparingRef.current = true;
    setPreparing(true);
    setPrepareError(false);
    const expectedRevisionId =
      visual.coverRatio && !visual.adoptedAt && visual.articleRevisionId ? visual.articleRevisionId : targetRevisionId;
    try {
      let imageAssetId = candidateAssetId;
      if (visual.coverRatio) {
        const asset =
          candidateAsset ??
          (
            await window.desktopApi.materialImageAssetsResolve({
              targets: [{ kind: 'IMAGE_ASSET', imageAssetId: candidateAssetId }],
            })
          )[0];
        if (!asset || asset.id !== candidateAssetId) throw new Error('COVER_SOURCE_UNAVAILABLE');
        imageAssetId = await prepareArticleCoverAdoption(visual, asset);
      }
      if (active.current !== candidateIdentity) return;
      controller.adopt(imageAssetId, intent, { imageAlt, expectedRevisionId });
    } catch {
      if (active.current === candidateIdentity) setPrepareError(true);
    } finally {
      preparingRef.current = false;
      if (active.current) setPreparing(false);
    }
  }
  return { preparing, prepareError, onAdopt };
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
  candidateAsset,
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
  const { preparing, prepareError, onAdopt } = usePreparedVisualAdoption({
    visual,
    candidateAssetId,
    candidateAsset,
    targetRevisionId,
    controller,
  });
  const busy = controller.busy || preparing;
  const { messages } = useI18n();
  const labels = messages.creator.derivedVisual;
  const inline = visual.role === 'ARTICLE_INLINE';
  const position = useMemo(
    () => (inline && targetArticle ? articleVisualPositionState(visual, targetArticle) : null),
    [inline, targetArticle, visual],
  );
  const positionBlocked = inline && (!position || position.status === 'MISSING' || position.status === 'AMBIGUOUS');
  const role = labels.targetRoles[visual.role] + (visual.coverRatio ? ` ${visual.coverRatio}` : '');
  const action = inline
    ? currentAssetId
      ? labels.replaceIllustration
      : labels.insertIllustration
    : visual.role === 'ARTICLE_HEADER'
      ? labels.setHero
      : labels.setCover;
  const applied = isAppliedCandidate({ visual, currentAssetId, candidateAssetId, targetArticle });

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
        disabled={controller.blocked || preparing || applied || !targetRevisionId || positionBlocked}
        onClick={() => onAdopt(inline ? 'REPLACE_INLINE' : 'SET_COVER')}
      >
        {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
        {applied ? labels.currentlyUsed : action + (visual.coverRatio ? ` ${visual.coverRatio}` : '')}
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
          disabled={controller.blocked || preparing || !targetRevisionId}
          onClick={() => onAdopt('SET_COVER_AND_FIRST')}
        >
          {labels.setCoverAndFirst}
        </Button>
      )}
      {prepareError && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {messages.contentEditor.coverEditor.failed}
        </div>
      )}
      <DerivedVisualOperationHistory controller={controller} />
    </div>
  );
}
