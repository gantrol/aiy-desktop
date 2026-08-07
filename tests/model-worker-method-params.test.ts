import { describe, expect, it } from 'vitest';
import { parseModelWorkerMethodParams } from '@/main/model-worker/method-params';

const minimalAssistInput = {
  mode: 'chat' as const,
  prompt: 'portrait',
  locale: 'en' as const,
  directTerms: [],
  recipes: [],
};

describe('model worker method parameters', () => {
  it('normalizes assistant defaults through the method-specific decoder', () => {
    const [job] = parseModelWorkerMethodParams('codex.chat', [
      {
        scope: { kind: 'DRAFT', id: 'draft-1' },
        request: {
          ...minimalAssistInput,
          scope: { kind: 'DRAFT', id: 'draft-1' },
          message: 'hello',
          attachmentAssetIds: [],
        },
        input: { ...minimalAssistInput, message: 'hello' },
        history: [],
        imagePaths: [],
      },
    ]);

    expect(job.input).toMatchObject({
      webSearchMode: 'DISABLED',
      directionStrategy: 'DIVERGENT',
      previousDirectionCoverage: [],
      contentNodes: [],
      candidateTerms: [],
      referenceAssets: [],
      canvasPresetKey: null,
      canvasWidth: null,
      canvasHeight: null,
      generationTargets: [],
    });
    expect(parseModelWorkerMethodParams('assistant.run', ['run-1'])).toEqual(['run-1']);
  });

  it('rejects missing, extra, and malformed parameters with a structured code', () => {
    for (const [method, params] of [
      ['generation.retry', []],
      ['worker.shutdown', ['unexpected']],
      ['image-transform.crop', [{ seriesId: 'series-1', sourceAssetId: 'asset-1', ratioWidth: 0, ratioHeight: 1 }]],
    ] as const) {
      try {
        parseModelWorkerMethodParams(method, params);
        throw new Error('Expected parameter validation to fail');
      } catch (error) {
        expect(error).toMatchObject({ code: 'MODEL_WORKER_INVALID_PARAMS' });
      }
    }
  });

  it('does not include provider credentials in validation diagnostics', () => {
    const apiKey = 'secret-provider-key-that-must-not-appear';

    expect(() =>
      parseModelWorkerMethodParams('extensions.configure-deepseek-api', [
        {
          apiKey,
          modelId: 'deepseek-chat',
          responsesUrl: 'not-a-url',
          configurationRevision: 'revision-1',
          verified: false,
          connectionMessage: '',
        },
      ]),
    ).toThrowError(expect.not.stringContaining(apiKey));
  });

  it('validates persisted conversation fields before forwarding a chat job', () => {
    const malformedHistory = {
      id: 'turn-1',
      scope: { kind: 'DRAFT', id: 'draft-1' },
      mode: 'chat',
      prompt: 'portrait',
      message: 'hello',
      attachments: [],
      result: {
        assistantMessage: 'hello',
        promptDraft: { summary: 'invalid', warnings: [], contentNodes: [{ kind: 'UNKNOWN' }] },
        sharedConstraints: [],
        assumptions: [],
        directions: [],
      },
      createdAt: '2026-08-06T00:00:00.000Z',
    };

    expect(() =>
      parseModelWorkerMethodParams('codex.chat', [
        {
          scope: { kind: 'DRAFT', id: 'draft-1' },
          request: {
            ...minimalAssistInput,
            scope: { kind: 'DRAFT', id: 'draft-1' },
            message: 'hello',
            attachmentAssetIds: [],
          },
          input: { ...minimalAssistInput, message: 'hello' },
          history: [malformedHistory],
          imagePaths: [],
        },
      ]),
    ).toThrowError(/promptDraft/);
  });
});
