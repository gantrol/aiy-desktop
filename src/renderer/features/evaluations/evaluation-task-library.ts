import { z } from 'zod';
import taskLibrarySource from '@/renderer/features/evaluations/evaluation-task-library.json';
import type { Locale } from '@/shared/contracts';
import type {
  EvaluationCase,
  EvaluationCriterionPhase,
  EvaluationInputPart,
} from '@/shared/contracts/evaluation-suite';

const localizedTextSchema = z
  .object({
    zh: z.string().trim().min(1).max(100_000),
    en: z.string().trim().min(1).max(100_000),
  })
  .strict();

const testLocatorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,99}$/u);

const testLocatorSchema = z
  .object({
    id: testLocatorIdSchema,
    label: localizedTextSchema,
  })
  .strict();

const publicTestCaseSchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9-]{2,99}$/u),
    title: localizedTextSchema,
    locatorIds: z.array(testLocatorIdSchema).min(1).max(100),
    steps: localizedTextSchema,
    expected: localizedTextSchema,
  })
  .strict();

const taskVerificationSchema = z
  .object({
    firstPassNotice: localizedTextSchema,
    locatorAttribute: z.literal('data-testid'),
    locators: z.array(testLocatorSchema).min(1).max(100),
    publicTests: z.array(publicTestCaseSchema).min(1).max(100),
    privateSuiteId: z.string().regex(/^idea-eval\/[a-z0-9-]+\/v[1-9][0-9]*$/u),
  })
  .strict();

const lifecyclePhaseSchema = z.enum(['IDEATION', 'DESIGN', 'DEVELOPMENT', 'ITERATION']);
const evaluationTaskReadinessSchema = z.enum(['READY', 'DRAFT']);
const evaluationPromptPacketStageSchema = z.enum(['FIRST_PASS', 'ITERATION']);

const modelVisibleFeedbackSchema = z
  .object({
    taskId: z.string().trim().min(1).max(100),
    publicFailures: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Z][A-Z0-9-]{2,99}$/u),
            title: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(100),
    privateBehaviorFailures: z.array(z.string().trim().min(1).max(2_000)).max(100),
    qualityFailures: z.array(z.string().trim().min(1).max(200)).max(20),
  })
  .strict();

const lifecyclePhasesSchema = z
  .object({
    IDEATION: localizedTextSchema,
    DESIGN: localizedTextSchema,
    DEVELOPMENT: localizedTextSchema,
    ITERATION: localizedTextSchema,
  })
  .strict();

const rubricCriterionSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    phase: lifecyclePhaseSchema,
    label: localizedTextSchema,
    description: localizedTextSchema,
    weight: z.number().positive().max(100),
    isGate: z.boolean(),
  })
  .strict();

const evaluationTaskTemplateSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    title: localizedTextSchema,
    source: z
      .object({
        label: localizedTextSchema,
        url: z.string().url().nullable(),
        revision: z.string().trim().min(1).max(200),
      })
      .strict(),
    difficulty: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
    readiness: evaluationTaskReadinessSchema,
    tags: z.array(z.string().trim().min(1).max(100)).max(20),
    phases: lifecyclePhasesSchema,
    expected: localizedTextSchema,
    verification: taskVerificationSchema.optional(),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.readiness === 'READY' && !task.verification) {
      context.addIssue({
        code: 'custom',
        path: ['verification'],
        message: 'Ready tasks require a verification contract',
      });
    }
    if (!task.verification) return;
    const locatorIds = task.verification.locators.map((locator) => locator.id);
    if (new Set(locatorIds).size !== locatorIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['verification', 'locators'],
        message: 'Verification locator IDs must be unique',
      });
    }

    const publicTestIds = task.verification.publicTests.map((testCase) => testCase.id);
    if (new Set(publicTestIds).size !== publicTestIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['verification', 'publicTests'],
        message: 'Public test IDs must be unique',
      });
    }

    const knownLocatorIds = new Set(locatorIds);
    const publicLocatorIds = new Set<string>();
    for (const [testIndex, testCase] of task.verification.publicTests.entries()) {
      if (new Set(testCase.locatorIds).size !== testCase.locatorIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['verification', 'publicTests', testIndex, 'locatorIds'],
          message: 'A public test cannot repeat locator IDs',
        });
      }
      for (const [locatorIndex, locatorId] of testCase.locatorIds.entries()) {
        publicLocatorIds.add(locatorId);
        if (!knownLocatorIds.has(locatorId)) {
          context.addIssue({
            code: 'custom',
            path: ['verification', 'publicTests', testIndex, 'locatorIds', locatorIndex],
            message: `Unknown public locator ID: ${locatorId}`,
          });
        }
      }
    }

    for (const [locatorIndex, locatorId] of locatorIds.entries()) {
      if (!publicLocatorIds.has(locatorId)) {
        context.addIssue({
          code: 'custom',
          path: ['verification', 'locators', locatorIndex, 'id'],
          message: `Every declared locator must be exercised by a public test: ${locatorId}`,
        });
      }
    }
  });

const evaluationTaskLibrarySchema = z
  .object({
    schemaVersion: z.literal(1),
    rubric: z.array(rubricCriterionSchema).min(1).max(50),
    sharedPhases: lifecyclePhasesSchema,
    tasks: z.array(evaluationTaskTemplateSchema).min(1).max(200),
  })
  .strict()
  .superRefine((library, context) => {
    if (new Set(library.tasks.map((task) => task.id)).size !== library.tasks.length) {
      context.addIssue({ code: 'custom', path: ['tasks'], message: 'Task template IDs must be unique' });
    }
    if (new Set(library.rubric.map((criterion) => criterion.key)).size !== library.rubric.length) {
      context.addIssue({ code: 'custom', path: ['rubric'], message: 'Rubric criterion keys must be unique' });
    }
    const totalWeight = library.rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.001) {
      context.addIssue({ code: 'custom', path: ['rubric'], message: 'Lifecycle rubric weights must total 100' });
    }
  });

export type LifecyclePhase = z.infer<typeof lifecyclePhaseSchema>;
export type EvaluationTaskReadiness = z.infer<typeof evaluationTaskReadinessSchema>;
export type EvaluationTaskTemplate = z.infer<typeof evaluationTaskTemplateSchema>;
export type EvaluationPromptPacketStage = z.infer<typeof evaluationPromptPacketStageSchema>;
export type EvaluationModelVisibleFeedback = z.infer<typeof modelVisibleFeedbackSchema>;

export type EvaluationPromptPacketSectionKey = LifecyclePhase | 'MODEL_VISIBLE_FEEDBACK';

export interface EvaluationPromptPacket {
  schemaVersion: 1;
  taskTemplateId: string;
  taskRevision: string;
  stage: EvaluationPromptPacketStage;
  sections: Array<{ key: EvaluationPromptPacketSectionKey; text: string }>;
  prompt: string;
}

export type EvaluationPromptPacketRequest =
  { stage: 'FIRST_PASS' } | { stage: 'ITERATION'; feedback: EvaluationModelVisibleFeedback };

export const lifecyclePhases = lifecyclePhaseSchema.options;
export const evaluationTaskLibrary = evaluationTaskLibrarySchema.parse(taskLibrarySource as unknown);

export function localizedText(value: { zh: string; en: string }, locale: Locale) {
  return value[locale];
}

export function lifecyclePhaseLabel(phase: EvaluationCriterionPhase, locale: Locale) {
  const labels =
    locale === 'zh'
      ? {
          GENERAL: '通用',
          IDEATION: '构思',
          DESIGN: '设计',
          DEVELOPMENT: '开发',
          ITERATION: '迭代',
        }
      : {
          GENERAL: 'General',
          IDEATION: 'Ideation',
          DESIGN: 'Design',
          DEVELOPMENT: 'Development',
          ITERATION: 'Iteration',
        };
  return labels[phase];
}

export function taskTemplateTag(templateId: string) {
  return `task-template:${templateId}`;
}

function firstPassVerificationPrompt(template: EvaluationTaskTemplate, locale: Locale) {
  if (!template.verification) return null;
  const heading = locale === 'zh' ? '首轮定位符契约（不是测试内容）' : 'First-pass locator contract (not test content)';
  const requirement =
    locale === 'zh'
      ? `以下稳定 ID 必须作为 ${template.verification.locatorAttribute} 提供。首轮不会给出测试步骤或断言。`
      : `Expose the following stable IDs through ${template.verification.locatorAttribute}. No test steps or assertions are provided in the first pass.`;
  return [
    localizedText(template.verification.firstPassNotice, locale),
    heading,
    requirement,
    ...template.verification.locators.map((locator) => `- ${locator.id}: ${localizedText(locator.label, locale)}`),
  ].join('\n');
}

function publicTestPrompt(template: EvaluationTaskTemplate, locale: Locale) {
  if (!template.verification) return null;
  const testHeading = locale === 'zh' ? '明测试（可见）' : 'Public tests (visible)';
  const locatorLabel = locale === 'zh' ? '定位符' : 'Locators';
  const stepsLabel = locale === 'zh' ? '步骤' : 'Steps';
  const expectedLabel = locale === 'zh' ? '通过条件' : 'Pass condition';
  const disclosure =
    locale === 'zh'
      ? '暗测试由评测器隔离运行，并且只能使用上述明测试已经使用的 data-testid。若暗测试失败，只向你提供行为问题清单，不提供暗测试源码、步骤、断言、输入组合或选择器。'
      : 'Private tests run in an isolated evaluator and may use only data-testid values already exercised by these public tests. If a private test fails, you receive only a behavioral problem list, never its source, steps, assertions, input combinations, or selectors.';
  return [
    testHeading,
    ...template.verification.publicTests.flatMap((testCase) => [
      `[${testCase.id}] ${localizedText(testCase.title, locale)}`,
      `${locatorLabel}: ${testCase.locatorIds.join(', ')}`,
      `${stepsLabel}: ${localizedText(testCase.steps, locale)}`,
      `${expectedLabel}: ${localizedText(testCase.expected, locale)}`,
      '',
    ]),
    disclosure,
  ]
    .join('\n')
    .trim();
}

export function taskPhasePrompt(template: EvaluationTaskTemplate, phase: LifecyclePhase, locale: Locale) {
  const sections = [
    localizedText(evaluationTaskLibrary.sharedPhases[phase], locale),
    localizedText(template.phases[phase], locale),
  ];
  const verificationSection =
    phase === 'DEVELOPMENT'
      ? firstPassVerificationPrompt(template, locale)
      : phase === 'ITERATION'
        ? publicTestPrompt(template, locale)
        : null;
  if (verificationSection) sections.push(verificationSection);
  return sections.join('\n\n');
}

function modelVisibleFeedbackPrompt(
  template: EvaluationTaskTemplate,
  feedback: EvaluationModelVisibleFeedback,
  locale: Locale,
) {
  const parsed = modelVisibleFeedbackSchema.parse(feedback);
  if (parsed.taskId !== template.id) throw new Error('Feedback does not match the task template');
  const hiddenCaseIdPattern = /\b[A-Z][A-Z0-9-]*-H\d{2}\b/u;
  if (hiddenCaseIdPattern.test(JSON.stringify(parsed))) {
    throw new Error('Model-visible feedback contains a private case ID');
  }
  const publicTestIds = new Set(template.verification?.publicTests.map((testCase) => testCase.id) ?? []);
  if (parsed.publicFailures.some((failure) => !publicTestIds.has(failure.id))) {
    throw new Error('Model-visible feedback contains an unknown public case ID');
  }
  const labels =
    locale === 'zh'
      ? { public: '明测试失败', private: '暗测行为问题', quality: '静态质量失败', none: '无' }
      : {
          public: 'Public test failures',
          private: 'Private behavioral issues',
          quality: 'Static quality failures',
          none: 'None',
        };
  const lines = (values: readonly string[]) =>
    values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${labels.none}`];
  return [
    labels.public,
    ...lines(parsed.publicFailures.map((failure) => `${failure.id}: ${failure.title}`)),
    '',
    labels.private,
    ...lines(parsed.privateBehaviorFailures),
    '',
    labels.quality,
    ...lines(parsed.qualityFailures),
  ].join('\n');
}

export function buildEvaluationPromptPacket(
  template: EvaluationTaskTemplate,
  locale: Locale,
  request: EvaluationPromptPacketRequest,
): EvaluationPromptPacket {
  if (template.readiness !== 'READY' || !template.verification) {
    throw new Error('Prompt packets can only be built for ready tasks');
  }
  const sections: EvaluationPromptPacket['sections'] =
    request.stage === 'FIRST_PASS'
      ? (['IDEATION', 'DESIGN', 'DEVELOPMENT'] as const).map((phase) => ({
          key: phase,
          text: taskPhasePrompt(template, phase, locale),
        }))
      : [
          { key: 'ITERATION', text: taskPhasePrompt(template, 'ITERATION', locale) },
          {
            key: 'MODEL_VISIBLE_FEEDBACK',
            text: modelVisibleFeedbackPrompt(template, request.feedback, locale),
          },
        ];
  return {
    schemaVersion: 1,
    taskTemplateId: template.id,
    taskRevision: template.source.revision,
    stage: evaluationPromptPacketStageSchema.parse(request.stage),
    sections,
    prompt: sections.map((section) => section.text).join('\n\n'),
  };
}

export function instantiateEvaluationTask(
  template: EvaluationTaskTemplate,
  locale: Locale,
  makeId: () => string,
): EvaluationCase {
  const inputParts: EvaluationInputPart[] = lifecyclePhases.map((phase, sortOrder) => ({
    id: makeId(),
    kind: 'TEXT',
    label: lifecyclePhaseLabel(phase, locale),
    sortOrder,
    text: taskPhasePrompt(template, phase, locale),
  }));

  return {
    id: makeId(),
    kind: 'SOFTWARE_TASK',
    title: localizedText(template.title, locale),
    inputParts,
    expected: localizedText(template.expected, locale),
    criteria: evaluationTaskLibrary.rubric.map((criterion) => ({
      id: makeId(),
      label: localizedText(criterion.label, locale),
      description: localizedText(criterion.description, locale),
      weight: criterion.weight,
      phase: criterion.phase,
      isGate: criterion.isGate,
    })),
    tags: [...template.tags, taskTemplateTag(template.id), `source-revision:${template.source.revision}`],
  };
}
