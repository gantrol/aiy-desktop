import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEEPSEEK_DEFAULT_MODEL_ID, DEEPSEEK_PROVIDER_KEY } from '@/main/assistant-models/deepseek-provider';
import type {
  AssistantOperation,
  AssistantReasoningEffort,
  AssistantRoutingSaveInput,
  AssistantRoutingSelection,
  AssistantRoutingSelections,
} from '@/shared/contracts';
import {
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_ASSISTANT_DEFAULT_MODEL_KEY,
  CODEX_ASSISTANT_DEFAULT_REASONING_EFFORT,
  DEEPSEEK_API_EXTENSION_ID,
} from '@/shared/extension-ids';

export interface AssistantModelDefinition {
  key: string;
  providerKey: string;
  modelKey: string;
  extensionId: string;
  name: string;
  kind: 'TEXT' | 'AGENT';
  supportedOperations: AssistantOperation[];
  modelSelectionMode: 'FIXED' | 'CATALOG';
  reasoningEffort: AssistantReasoningEffort | null;
}

interface PersistedAssistantRouting {
  schemaVersion: 1;
  selections: AssistantRoutingSelections;
  updatedAt: string;
}

export const ASSISTANT_MODEL_DEFINITIONS: readonly AssistantModelDefinition[] = [
  {
    key: DEEPSEEK_DEFAULT_MODEL_ID,
    providerKey: DEEPSEEK_PROVIDER_KEY,
    modelKey: DEEPSEEK_DEFAULT_MODEL_ID,
    extensionId: DEEPSEEK_API_EXTENSION_ID,
    name: 'DeepSeek V4 Flash',
    kind: 'TEXT',
    supportedOperations: ['directions', 'optimize', 'title'],
    modelSelectionMode: 'FIXED',
    reasoningEffort: null,
  },
  {
    key: 'codex',
    providerKey: 'codex',
    modelKey: CODEX_ASSISTANT_DEFAULT_MODEL_KEY,
    extensionId: CODEX_APP_SERVER_EXTENSION_ID,
    name: 'Codex Agent',
    kind: 'AGENT',
    supportedOperations: ['directions', 'optimize', 'title'],
    modelSelectionMode: 'CATALOG',
    reasoningEffort: CODEX_ASSISTANT_DEFAULT_REASONING_EFFORT,
  },
] as const;

const DEFAULT_SELECTIONS: AssistantRoutingSelections = {
  directions: { routeKey: 'codex', modelKey: null, reasoningEffort: null },
  optimize: { routeKey: 'codex', modelKey: null, reasoningEffort: null },
  title: { routeKey: 'codex', modelKey: null, reasoningEffort: null },
};

const assistantReasoningEfforts = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const satisfies readonly AssistantReasoningEffort[];

const REASONING_EFFORTS = new Set<AssistantReasoningEffort>(assistantReasoningEfforts);
const assistantReasoningEffortSchema = z.enum(assistantReasoningEfforts);
const assistantRoutingSelectionSchema: z.ZodType<AssistantRoutingSelection> = z
  .object({
    routeKey: z.string().min(1).max(200),
    modelKey: z.string().min(1).max(200).nullable(),
    reasoningEffort: assistantReasoningEffortSchema.nullable(),
  })
  .strict();
const persistedAssistantRoutingSchema: z.ZodType<PersistedAssistantRouting> = z
  .object({
    schemaVersion: z.literal(1),
    selections: z
      .object({
        directions: assistantRoutingSelectionSchema,
        optimize: assistantRoutingSelectionSchema,
        title: assistantRoutingSelectionSchema,
      })
      .strict(),
    updatedAt: z.string().datetime(),
  })
  .strict();

function copySelections(selections: AssistantRoutingSelections): AssistantRoutingSelections {
  return {
    directions: { ...selections.directions },
    optimize: { ...selections.optimize },
    title: { ...selections.title },
  };
}

function modelFor(operation: AssistantOperation, routeKey: string) {
  return ASSISTANT_MODEL_DEFINITIONS.find(
    (model) => model.key === routeKey && model.supportedOperations.includes(operation),
  );
}

export class AssistantRoutingConfiguration {
  constructor(private readonly filePath: string) {}

  get() {
    const persisted = this.read();
    return {
      selections: copySelections(persisted?.selections ?? DEFAULT_SELECTIONS),
      updatedAt: persisted?.updatedAt ?? null,
    };
  }

  save(input: AssistantRoutingSaveInput) {
    this.validate(input.selections);
    const record: PersistedAssistantRouting = {
      schemaVersion: 1,
      selections: copySelections(input.selections),
      updatedAt: new Date().toISOString(),
    };
    this.write(record);
    return this.get();
  }

  resolve(operation: AssistantOperation) {
    const selection = this.get().selections[operation];
    const model = modelFor(operation, selection.routeKey);
    if (!model) throw new Error(`Configured assistant model ${selection.routeKey} does not support ${operation}`);
    return {
      ...model,
      modelKey: selection.modelKey ?? model.modelKey,
      reasoningEffort: selection.reasoningEffort ?? model.reasoningEffort,
    };
  }

  private validate(selections: AssistantRoutingSelections) {
    for (const operation of ['directions', 'optimize', 'title'] as const) {
      const selection = selections[operation];
      const model = modelFor(operation, selection.routeKey);
      if (!model) {
        throw new Error(`Assistant model ${selection.routeKey} does not support ${operation}`);
      }
      if (
        selection.modelKey !== null &&
        (model.modelSelectionMode !== 'CATALOG' ||
          !selection.modelKey ||
          selection.modelKey.length > 200 ||
          selection.modelKey.trim() !== selection.modelKey)
      ) {
        throw new Error(`Assistant model ${selection.modelKey} is not valid for ${model.name}`);
      }
      if (
        selection.reasoningEffort !== null &&
        (model.modelSelectionMode !== 'CATALOG' || !REASONING_EFFORTS.has(selection.reasoningEffort))
      ) {
        throw new Error(`Assistant reasoning effort ${selection.reasoningEffort} is not valid for ${model.name}`);
      }
    }
  }

  private read(): Omit<PersistedAssistantRouting, 'schemaVersion'> | null {
    try {
      const parsed = persistedAssistantRoutingSchema.safeParse(
        JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown,
      );
      if (!parsed.success) {
        throw new Error('Stored assistant routing configuration is invalid');
      }
      this.validate(parsed.data.selections);
      return { selections: parsed.data.selections, updatedAt: parsed.data.updatedAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private write(record: PersistedAssistantRouting) {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporaryPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        /* no partial configuration remains */
      }
      throw error;
    }
  }
}
