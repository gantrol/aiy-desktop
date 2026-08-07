import type { CodexAssistInput } from '@/shared/contracts';
import {
  buildStructuredAssistantSystemPrompt,
  type AssistantPromptProfile,
} from '@/main/assistant-models/prompts/common';

export const DIRECTION_SCOUT_PROMPT_PROFILE = 'direction-scout-v1';
const DIVERGENT_DIRECTION_COUNT = 4;
const ADJACENT_DIRECTION_COUNT = 3;

export interface DirectionScoutPromptProfile extends AssistantPromptProfile {
  kind: 'directions';
  expectedDirectionCount: number;
  minimumDirectionCount: number;
}

function compactText(value: string, maximumLength: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}

function directionCount(input: CodexAssistInput) {
  return input.directionStrategy === 'ADJACENT' ? ADJACENT_DIRECTION_COUNT : DIVERGENT_DIRECTION_COUNT;
}

function creatorPayload(input: CodexAssistInput) {
  return {
    instruction: input.prompt.slice(0, 30_000),
    selectedTerms: input.directTerms.slice(0, 40).map((term) => ({
      name: compactText(term.displayName, 160),
      cue: compactText(term.promptFragment, 480),
      avoid: compactText(term.negativeFragment, 240),
    })),
    selectedRecipes: input.recipes.slice(0, 16).map((recipe) => ({
      name: compactText(recipe.displayName, 160),
      parameters: recipe.parameters.slice(0, 12).map((parameter) => ({
        name: compactText(parameter.displayName, 120),
        value: compactText(parameter.selectedOptionLabel || parameter.selectedValue, 160),
      })),
      cue: compactText(recipe.promptFragment, 640),
      avoid: compactText(recipe.negativeFragment, 320),
    })),
    references: (input.referenceAssets ?? []).slice(0, 12).map((asset) => ({
      kind: asset.kind,
      width: asset.width,
      height: asset.height,
      mimeType: compactText(asset.mimeType, 80),
    })),
    canvas: input.canvasPresetKey?.slice(0, 120) ?? null,
    previousCoverage: (input.previousDirectionCoverage ?? []).slice(0, 16).map((direction) => ({
      label: compactText(direction.label, 160),
      variableAxis: compactText(direction.variableAxis, 240),
    })),
    selectionSignal: input.message?.slice(0, 4_000) ?? '',
  };
}

function resultShape() {
  return {
    assistantMessage: '',
    sharedConstraints: [] as string[],
    assumptions: [] as Array<{ label: string; interpretation: string; impact: string }>,
    directions: [
      {
        label: '',
        prompt: '',
        rationale: '',
        variableAxis: '',
        risk: '',
      },
    ],
  };
}

export function buildDirectionScoutPromptProfile(input: CodexAssistInput): DirectionScoutPromptProfile {
  const expectedDirectionCount = directionCount(input);
  const hasBaseInstruction = Boolean(input.prompt.trim());
  const adjacent = input.directionStrategy === 'ADJACENT';
  const task = adjacent
    ? `围绕 selectionSignal 生成恰好 ${expectedDirectionCount} 个相邻方向。保持选中的变化轴，每个方向取一个不同的邻近值。`
    : `生成恰好 ${expectedDirectionCount} 个有用且明显不同的创作方向。共同约束保持不变，每个方向只改变一个主要视觉轴。前三个方向优先提供有效差异；第四个方向可以更意外，但必须与用户目标相关。`;
  const coverageRule = adjacent
    ? 'previousCoverage 只用于避免完全重复，不得排除用户明确选中的相邻变化轴。'
    : '不得重复 previousCoverage 中已有的方向或变化轴。';
  const promptRule = hasBaseInstruction
    ? 'direction.prompt 只包含本方向的变化增量，应用会将它追加到原始输入。'
    : '没有原始输入时，direction.prompt 必须是简短且可独立使用的视觉种子。';
  const rules = `所有字段保持简短。共同约束只列一次，最多 4 项；只有必要时才列假设，最多 2 项。
把模糊意图转成可观察的视觉选择。方向必须实质不同，不能只是换一种说法，并且每个方向只能改变一个变化轴。
${coverageRule}
${promptRule}
理由和风险必须具体。不得包含供应商名称、模型语法、质量标记或参数写法。`;

  return {
    id: DIRECTION_SCOUT_PROMPT_PROFILE,
    kind: 'directions',
    systemPrompt: buildStructuredAssistantSystemPrompt({
      role: '你是视觉创作方向侦察助手。只提出方向，不生成图片，也不改写用户草稿。',
      task,
      rules,
      locale: input.locale,
      resultShape: resultShape(),
    }),
    creatorPayload: creatorPayload(input),
    temperature: adjacent ? 0.75 : 0.95,
    maxOutputTokens: 1_400,
    expectedDirectionCount,
    minimumDirectionCount: 3,
  };
}

export function expandDirectionPrompt(basePrompt: string, directionDelta: string) {
  const base = basePrompt.trim();
  const delta = directionDelta.trim();
  if (!base) return delta;
  if (delta.startsWith(base)) return delta;
  return `${base}\n\n${delta}`;
}
