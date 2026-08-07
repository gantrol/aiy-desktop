import type { CodexAssistInput } from '@/shared/contracts';
import {
  buildStructuredAssistantSystemPrompt,
  type AssistantPromptProfile,
} from '@/main/assistant-models/prompts/common';

export const PROMPT_OPTIMIZATION_PROFILE = 'prompt-draft-v1';

export interface PromptOptimizationProfile extends AssistantPromptProfile {
  kind: 'optimize';
}

function resultShape() {
  return {
    assistantMessage: '简短说明草稿调整内容',
    promptDraft: {
      summary: '草稿调整摘要',
      warnings: ['需要用户留意的具体问题'],
      contentNodes: [
        { kind: 'TEXT', text: '整理后的自由文本' },
        { kind: 'TERM', termId: '候选或已选词条 ID', termRevisionId: '对应词条版本 ID' },
        { kind: 'RECIPE', paletteId: '已选配方 ID', paletteRevisionId: '对应配方版本 ID' },
      ],
    },
    sharedConstraints: ['草稿仍保持的视觉要求'],
    assumptions: [{ label: '假设', interpretation: '推断内容', impact: '可能影响' }],
    directions: [] as unknown[],
  };
}

export function buildPromptOptimizationProfile(
  input: CodexAssistInput,
  creatorPayload: unknown,
): PromptOptimizationProfile {
  return {
    id: PROMPT_OPTIMIZATION_PROFILE,
    kind: 'optimize',
    systemPrompt: buildStructuredAssistantSystemPrompt({
      role: '构思AI绘图指令。',
      task: `请依次补充：
1. 核心主体及外观特征
2. 动作、姿态或状态
3. 场景、时间、天气和背景
4. 前景、中景、远景
5. 构图、视角和景别
6. 光线方向、强弱和氛围
7. 主色、辅色和色彩关系
8. 材质、纹理和细节
9. 绘画媒介或视觉风格
10. 画面情绪和叙事感
11. 应避免的元素
12. 推荐画幅比例`,
      rules: `将TERM 和 RECIPE 的语义视为最终 Prompt 中已经存在的内容。
TEXT 只能补充这些结构化节点尚未覆盖的信息，不得直接复制、改写或同义复述其 promptFragment、参数或内部词条。
逐项补齐主体、动作、场景等信息时，应先判断现有 TERM/RECIPE 是否已经覆盖；已覆盖则跳过。
保留 RECIPE 时，不得同时新增该配方 internalTerms 中的 TERM；用户原本直接选择的 TERM 可以保留。
若 TEXT 与 RECIPE 重复，默认删除重复 TEXT 并保留 RECIPE；
若发生冲突，只保留更符合用户明确意图的一方，禁止仅通过 warning 保留两套冲突描述。
`,
      locale: input.locale,
      resultShape: resultShape(),
    }),
    creatorPayload,
    temperature: 0.3,
    maxOutputTokens: 4_096,
  };
}
