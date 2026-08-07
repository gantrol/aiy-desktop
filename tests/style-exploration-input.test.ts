import { describe, expect, it } from 'vitest';
import type { AssistantRunDto, DirectionProposalDto, GenerationTargetInput } from '../src/shared/contracts';
import { buildStyleExplorationStartInput } from '../src/renderer/components/creator/styleExploration';

const directions: DirectionProposalDto[] = [
  { label: 'Warm', prompt: 'warm rim light', rationale: 'Warm', variableAxis: 'light', risk: 'red cast' },
  { label: 'Cool', prompt: 'cool window light', rationale: 'Cool', variableAxis: 'light', risk: 'flat skin' },
];
const frozenTargets: GenerationTargetInput[] = [{ modelKey: 'gpt-image-2', count: 2, quality: 'medium' }];

const result = {
  assistantMessage: 'Two directions',
  optimizedPrompt: '',
  promptEdit: {
    summary: '',
    preserved: [],
    changes: [],
    removed: [],
    revisedUserInstruction: '',
  },
  sharedConstraints: ['same subject', 'same framing'],
  assumptions: [],
  directions,
};

const assistantRun = {
  id: 'assistant-1',
  scope: { kind: 'DRAFT', id: 'draft-1' },
  mode: 'directions',
  status: 'SUCCEEDED',
  contextKey: 'context-1',
  contextHash: 'hash-1',
  input: {
    scope: { kind: 'DRAFT', id: 'draft-1' },
    mode: 'directions',
    prompt: 'portrait',
    locale: 'en',
    directTerms: [],
    recipes: [],
    contextKey: 'context-1',
    referenceAssets: [],
    termPromptLocale: 'en',
    canvasPresetKey: null,
    canvasWidth: null,
    canvasHeight: null,
    generationTargets: frozenTargets,
  },
  capabilityReceipt: { directTermCount: 0, recipeCount: 0, referenceCount: 0, visionAnalyzed: false },
  proposal: {
    id: 'proposal-1',
    assistantRunId: 'assistant-1',
    status: 'READY',
    adoptedContextKey: null,
    result,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  errorMessage: '',
  dismissedAt: null,
  createdAt: '2026-01-01',
  finishedAt: '2026-01-01',
} satisfies AssistantRunDto;

describe('style exploration input builder', () => {
  it('freezes a separate structured prompt and stable target copy for every direction', () => {
    const targets: GenerationTargetInput[] = frozenTargets.map((target) => ({ ...target }));
    const input = buildStyleExplorationStartInput({
      assistantRun,
      directions,
      locale: 'en',
    });

    targets[0].count = 9;
    expect(input).toMatchObject({
      scope: { kind: 'DRAFT', id: 'draft-1' },
      sourceAssistantRunId: 'assistant-1',
      commonConstraints: ['same subject', 'same framing'],
      targets: [{ modelKey: 'gpt-image-2', count: 2, quality: 'medium' }],
    });
    expect(
      input.slots.map((slot) => ({
        label: slot.label,
        userInstruction: slot.userInstruction,
        manualPrompt: slot.input.manualPrompt,
        prompt: slot.input.prompt,
        quality: slot.input.quality,
      })),
    ).toEqual([
      {
        label: 'Warm',
        userInstruction: 'warm rim light',
        manualPrompt: 'warm rim light',
        prompt: 'warm rim light',
        quality: 'medium',
      },
      {
        label: 'Cool',
        userInstruction: 'cool window light',
        manualPrompt: 'cool window light',
        prompt: 'cool window light',
        quality: 'medium',
      },
    ]);
    expect(input.slots[0].input.resolvedPrompt).not.toBe(input.slots[1].input.resolvedPrompt);
  });
});
