import type { GifMotionPlan, GifMotionRegion } from '@/shared/contracts/gif-motion-plan';
import type { GifMotionDraft } from '@/shared/contracts/gif-motion-draft';
import type { GifDocument } from '@/shared/contracts/gif-making';
import type { useGifProject } from '@/renderer/features/gif-making/useGifProject';

const emptyDraft: GifMotionDraft = {
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

/** The form belongs to the motion draft, independently of the assembled GIF. */
export function useGifMotionIntent(project: ReturnType<typeof useGifProject>) {
  const savedDraft = project.document.motionDraft ?? emptyDraft;
  const draft = { ...savedDraft, returnMode: savedDraft.plan?.returnMode ?? savedDraft.returnMode };
  const update = (patch: Partial<GifMotionDraft>) => {
    const current = project.capture().motionDraft ?? emptyDraft;
    project.updateDraft({ ...current, returnMode: current.plan?.returnMode ?? current.returnMode, ...patch });
  };
  return {
    draft,
    ...draft,
    setPrompt: (prompt: string) => {
      const current = project.capture().motionDraft;
      // A region accepted from the old plan must not constrain a new intent.
      // Direct region edits already clear the plan and remain user input.
      update({
        prompt,
        plan: null,
        ...(current?.plan?.region ? { mode: 'WHOLE', region: null } : {}),
      });
    },
    setMode: (mode: 'WHOLE' | 'REGION') => update({ mode, plan: null }),
    setRegion: (region: GifMotionRegion | null) => update({ region, plan: null }),
    setPlan: (plan: GifMotionPlan | null) => update({ plan }),
    setDurationMs: (durationMs: number) => update({ durationMs }),
    setFeather: (feather: number) => update({ feather }),
    setQuality: (quality: GifMotionDraft['quality']) => update({ quality }),
    setGenerationMode: (generationMode: GifMotionDraft['generationMode']) => update({ generationMode }),
    setReturnMode: (returnMode: GifMotionDraft['returnMode']) => update({ returnMode, plan: null }),
    setModelKey: (modelKey: string) => update({ modelKey }),
    resetSource: () => update({ plan: null, region: null }),
    applyPlan: (plan: GifMotionPlan, expected: GifDocument) => {
      const current = project.capture();
      if (
        current.id !== expected.id ||
        current.manifest !== expected.manifest ||
        current.motionDraft !== expected.motionDraft
      )
        return false;
      update({ plan, returnMode: plan.returnMode, mode: plan.mode, region: plan.region, durationMs: plan.durationMs });
      if (!current.title) project.title(plan.title);
      return true;
    },
  };
}
