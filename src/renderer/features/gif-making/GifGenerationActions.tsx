import { LoaderCircleIcon, FilmIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { gifMotionPlanSchema } from '@/shared/contracts/gif-motion-plan';
import type { GifErrorCode } from '@/shared/contracts/gif-making';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { GifGenerationModel } from '@/renderer/features/gif-making/useGifGeneration';

function generationBlock(motion: GifGenerationModel): GifErrorCode | null {
  if (motion.mode === 'REGION' && !motion.region) return 'GIF_REGION_REQUIRED';
  if (!motion.plan) return null;
  const validPlan = gifMotionPlanSchema.safeParse({
    ...motion.plan,
    mode: motion.mode,
    region: motion.mode === 'REGION' ? motion.region : null,
    durationMs: motion.durationMs,
  }).success;
  if (!validPlan) return 'GIF_PLAN_INVALID';
  if (!motion.routes.some((route) => route.key === motion.modelKey && route.state === 'READY'))
    return 'GIF_MODEL_UNAVAILABLE';
  return null;
}

export function GifGenerationStatus({ motion }: { motion: GifGenerationModel }) {
  const copy = useI18n().messages.creator.gifMaker;
  const labels = copy.generation;
  if (!motion.running) {
    if (!motion.source || !motion.prompt.trim()) return null;
    const blocked = generationBlock(motion);
    if (blocked) return <span>{copy.errors[blocked]}</span>;
    return motion.plan ? (
      <span data-gif-generation-new-images>
        {labels.newImages}: {motion.plan.states.length - 1}
      </span>
    ) : null;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <LoaderCircleIcon className="size-3 animate-spin" />
      {motion.planning ? labels.planning : motion.state ? labels.stages[motion.state] : null}
      {!motion.planning && motion.progress?.totalRequests !== undefined && (
        <span data-gif-generation-request-progress className="tabular-nums">
          {motion.progress.completedRequests ?? 0} / {motion.progress.totalRequests}
        </span>
      )}
    </span>
  );
}

export function GifGenerationActions({ motion, disabled }: { motion: GifGenerationModel; disabled: boolean }) {
  const labels = useI18n().messages.creator.gifMaker.generation;
  if (motion.running) {
    return (
      <Button variant="outline" size="sm" onClick={() => void motion.cancel()}>
        {motion.planning ? labels.cancelPlanning : labels.cancel}
      </Button>
    );
  }
  return (
    <Button
      data-action={motion.plan ? 'gif-confirm-generate' : 'gif-propose-plan'}
      size="sm"
      disabled={
        disabled || motion.adopting || !motion.source || !motion.prompt.trim() || Boolean(generationBlock(motion))
      }
      onClick={() => void (motion.plan ? motion.generate() : motion.propose())}
    >
      <FilmIcon className="size-4" />
      {motion.plan ? labels.confirmGenerate : labels.planAction}
    </Button>
  );
}
