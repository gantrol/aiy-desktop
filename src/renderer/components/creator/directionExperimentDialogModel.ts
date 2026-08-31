import type {
  AssistantAssumptionDto,
  AssistantRunDto,
  CanvasPresetDto,
  DirectionProposalDto,
  GenerationTargetInput,
  Locale,
} from '@/shared/contracts';

interface Input {
  assistantRun: AssistantRunDto | null;
  canvasPresets: readonly CanvasPresetDto[];
  currentCanvasPreset: CanvasPresetDto | null;
  currentGenerationTargets: readonly GenerationTargetInput[];
  currentReferenceCount: number;
  directions: readonly DirectionProposalDto[];
  locale: Locale;
}

export interface DirectionExperimentDialogModel {
  assumptions: AssistantAssumptionDto[];
  canvasLabel: string | null;
  commonConstraints: string[];
  directions: DirectionProposalDto[];
  objective: string;
  open: boolean;
  referenceCount: number;
  remoteScope: string[];
  targets: GenerationTargetInput[];
}

function canvasLabel({ assistantRun, canvasPresets, currentCanvasPreset, locale }: Input) {
  const input = assistantRun?.input ?? null;
  const canvas = input
    ? canvasPresets.find((preset) => preset.stableKey === input.canvasPresetKey)
    : currentCanvasPreset;
  const width = input ? input.canvasWidth : currentCanvasPreset?.width;
  const height = input ? input.canvasHeight : currentCanvasPreset?.height;
  if (!width || !height) return null;
  const name = canvas?.ratio || input?.canvasPresetKey || (locale === 'zh' ? '自定义' : 'Custom');
  return `${name} · ${width}×${height}`;
}

function objective({ assistantRun, directions, locale }: Input) {
  return (
    assistantRun?.input.prompt.trim() ||
    assistantRun?.proposal?.result.promptEdit?.summary.trim() ||
    directions.map((direction) => direction.label).join(' / ') ||
    (locale === 'zh' ? '方向实验' : 'Direction experiment')
  ).slice(0, 2_000);
}

function remoteScope(locale: Locale, referenceCount: number) {
  return locale === 'zh'
    ? [
        '方向 Prompt 与结构化词条、配方',
        ...(referenceCount ? [`${referenceCount} 个参考图片文件`] : []),
        '模型、质量与画幅设置',
      ]
    : [
        'Direction prompts, structured terms and recipes',
        ...(referenceCount ? [`${referenceCount} reference image files`] : []),
        'Model, quality and canvas settings',
      ];
}

export function buildDirectionExperimentDialogModel(input: Input): DirectionExperimentDialogModel {
  const { assistantRun } = input;
  const referenceCount = assistantRun?.input.referenceAssets.length ?? input.currentReferenceCount;
  const targets = assistantRun?.input.generationTargets ?? input.currentGenerationTargets;
  return {
    assumptions: assistantRun?.proposal?.result.assumptions ?? [],
    canvasLabel: canvasLabel(input),
    commonConstraints: assistantRun?.proposal?.result.sharedConstraints ?? [],
    directions: input.directions.map((direction) => ({ ...direction })),
    objective: objective(input),
    open: Boolean(assistantRun),
    referenceCount,
    remoteScope: remoteScope(input.locale, referenceCount),
    targets: targets.map((target) => ({ ...target })),
  };
}
