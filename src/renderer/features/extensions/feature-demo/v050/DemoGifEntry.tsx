import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { GifWorkflowNav } from '@/renderer/features/gif-making/GifWorkflowNav';
import { GifGenerationPanel } from '@/renderer/features/gif-making/GifGenerationPanel';
import { GifGenerationActions } from '@/renderer/features/gif-making/GifGenerationActions';
import { GifMotionRegionEditor } from '@/renderer/features/gif-making/GifMotionRegion';
import type { GifGenerationModel } from '@/renderer/features/gif-making/useGifGeneration';
import type { GifMotionDraft } from '@/shared/contracts/gif-motion-draft';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  demoAsyncNoop,
  demoNoop,
  demoRoseAsset,
  demoPreparedRoute,
} from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
import { demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import { demoPromptText } from '@/renderer/features/extensions/feature-demo/v050/demoWorkspaceScene';
import { demoSmilePlan, demoSmileDuration } from '@/renderer/features/extensions/feature-demo/v050/demoSmileData';
import { DemoSmileResult } from '@/renderer/features/extensions/feature-demo/v050/DemoSmileResult';

const draft: GifMotionDraft = {
  prompt: '',
  mode: 'WHOLE',
  region: null,
  plan: null,
  durationMs: 2400,
  modelKey: '',
  quality: 'high',
  generationMode: 'FRAMES',
  returnMode: 'CONTINUE',
  feather: 0.15,
};

/** Only local presentation state: no saved document, job or provider executor. */
const emptyMotion: GifGenerationModel = {
  draft,
  ...draft,
  source: demoRoseAsset,
  routes: [],
  candidate: null,
  history: [],
  historyLoading: false,
  providerMessage: null,
  state: null,
  progress: null,
  running: false,
  adopting: false,
  planning: false,
  setPrompt: demoNoop,
  setMode: demoNoop,
  setRegion: demoNoop,
  setPlan: demoNoop,
  setDurationMs: demoNoop,
  setFeather: demoNoop,
  setQuality: demoNoop,
  setGenerationMode: demoNoop,
  setReturnMode: demoNoop,
  setModelKey: demoNoop,
  resetSource: demoNoop,
  applyPlan: () => false,
  selectCandidate: demoNoop,
  generate: demoAsyncNoop,
  propose: demoAsyncNoop,
  cancel: demoAsyncNoop,
  adopt: demoAsyncNoop,
  failedPreview: demoNoop,
};

export function DemoGifEntry({ time, mediaReady, onError }: { time: number; mediaReady: boolean; onError(): void }) {
  const { messages } = useI18n();
  const labels = messages.creator.gifMaker;
  const copy = messages.extensions.featureDemo.v050;
  const review = time >= demoCues.motionResult;
  const planReady = time >= demoCues.planReady;
  const plan = useMemo(() => demoSmilePlan(copy), [copy]);
  const routes = useMemo(() => [demoPreparedRoute(copy.prepared)], [copy.prepared]);
  const currentDraft: GifMotionDraft = {
    ...draft,
    prompt: demoPromptText(time, copy.smilePrompt, demoCues.motionTypingStart, demoCues.motionTypingEnd),
    plan: planReady ? plan : null,
    mode: planReady ? plan.mode : draft.mode,
    region: planReady ? plan.region : null,
    durationMs: planReady ? demoSmileDuration : draft.durationMs,
    modelKey: 'demo-prepared',
  };
  const motion: GifGenerationModel = { ...emptyMotion, ...currentDraft, draft: currentDraft, routes };
  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon-sm" aria-label={labels.close} onClick={demoNoop}>
          <ArrowLeft />
        </Button>
        <span className="text-sm font-medium">{labels.workspaceTitle}</span>
        <Input
          className="h-8 max-w-80"
          value={planReady ? copy.smileTitle : ''}
          readOnly
          placeholder={labels.untitled}
          aria-label={labels.projectTitle}
        />
        <span className="ml-auto text-xs text-muted-foreground">{labels.unsaved}</span>
      </header>
      <GifWorkflowNav step={review ? 'review' : 'generate'} running={false} disabled={false} onChange={demoNoop} />
      <div className="relative min-h-0 flex-1">
        <div
          className="absolute inset-0 grid grid-cols-[620px_1fr]"
          style={{ visibility: review ? 'hidden' : 'inherit' }}
        >
          <div className="flex min-h-0 items-center justify-center border-r bg-muted/40 p-8">
            {planReady ? (
              <GifMotionRegionEditor
                source={demoRoseAsset}
                region={motion.region}
                onChange={demoNoop}
                disabled={false}
                label={labels.generation.source}
              />
            ) : (
              <img
                data-demo-media
                src={demoRoseAsset.mediaUrl}
                alt={labels.generation.source}
                className="max-h-full max-w-full object-contain"
                onError={onError}
              />
            )}
          </div>
          <div className="flex min-h-0 flex-col p-6">
            <div className="min-h-0 flex-1 overflow-y-auto pb-4">
              <GifGenerationPanel
                motion={motion}
                disabled={false}
                selectedPlanState={0}
                onSelectedPlanStateChange={demoNoop}
              />
            </div>
            <div className="mt-auto flex justify-end border-t pt-4">
              <GifGenerationActions motion={motion} disabled={false} />
            </div>
          </div>
        </div>
        {review && mediaReady && <DemoSmileResult time={time} onError={onError} />}
      </div>
    </div>
  );
}
