import { describe, expect, it } from 'vitest';
import type { CodexAssistInput, CreatorAgentTurnDto } from '../src/shared/contracts';
import { buildCodexAssistCreatorPayload, buildCodexAssistPrompt, normalizeAssistResult } from '../src/main/codex';

const input = {
  mode: 'directions',
  prompt: '主角级萌系角色',
  locale: 'zh',
  directTerms: [
    {
      stableId: 'term-direct',
      revisionId: 'term-direct-v2',
      expressionRevisionId: 'term-direct-gpt-v3',
      displayName: '柔和轮廓',
      promptFragment: 'soft silhouette',
      negativeFragment: '',
    },
  ],
  recipes: [
    {
      useId: 'recipe-outfit:recipe-outfit-v4',
      stableId: 'recipe-outfit',
      revisionId: 'recipe-outfit-v4',
      displayName: '主角级穿搭',
      promptLocale: 'zh',
      parameterValues: { density: 'ornate' },
      parameters: [
        {
          stableId: 'parameter-density',
          revisionId: 'parameter-density-v2',
          displayName: '繁复度',
          selectedValue: 'ornate',
          selectedOptionId: 'option-ornate-v1',
          selectedOptionLabel: '繁而有序',
          promptFragment: 'intricate but ordered',
        },
      ],
      referenceAssets: [
        {
          assetId: 'asset-outfit-reference',
          kind: 'REFERENCE',
          originType: 'LOCAL_IMPORT',
          width: 1024,
          height: 1536,
          mimeType: 'image/png',
        },
      ],
      promptFragment: 'hero-grade outfit, intricate but ordered',
      negativeFragment: 'generic clothing',
      internalTerms: [
        {
          stableId: 'term-hero-outfit',
          revisionId: 'term-hero-outfit-v1',
          expressionRevisionId: 'term-hero-outfit-gpt-v1',
          displayName: '主角服饰',
          promptFragment: 'hero-grade outfit',
          negativeFragment: '',
        },
      ],
    },
  ],
} satisfies CodexAssistInput;

describe('Codex creator-assist input', () => {
  it('keeps user instruction, direct terms and aggregate recipes as separate facts', () => {
    const payload = buildCodexAssistCreatorPayload(input);

    expect(payload.currentPrompt.userInstruction).toBe('主角级萌系角色');
    expect(payload.currentPrompt.directTerms.map((term) => term.stableId)).toEqual(['term-direct']);
    expect(payload.currentPrompt.recipes).toEqual([
      expect.objectContaining({
        useId: 'recipe-outfit:recipe-outfit-v4',
        stableId: 'recipe-outfit',
        revisionId: 'recipe-outfit-v4',
        displayName: '主角级穿搭',
        parameterValues: { density: 'ornate' },
        parameters: [
          expect.objectContaining({
            revisionId: 'parameter-density-v2',
            selectedOptionId: 'option-ornate-v1',
          }),
        ],
        referenceAssets: [expect.objectContaining({ assetId: 'asset-outfit-reference' })],
        internalTerms: [expect.objectContaining({ stableId: 'term-hero-outfit' })],
      }),
    ]);
    expect(payload.currentPrompt.directTerms.map((term) => term.stableId)).not.toContain('term-hero-outfit');
    expect(payload.currentPrompt).not.toHaveProperty('selectedTerms');
  });

  it('tells the model that nested recipe terms are not peer selections', () => {
    const prompt = buildCodexAssistPrompt(input);

    expect(prompt).toContain('Each recipes entry is one aggregate recipe');
    expect(prompt).toContain('internalTerms are nested recipe details only');
    expect(prompt).toContain('"directTerms"');
    expect(prompt).toContain('"recipes"');
    expect(prompt).not.toContain('"selectedTerms"');
  });

  it('keeps ordinary conversation history explicit and bounded', () => {
    const history = Array.from({ length: 22 }, (_, index): CreatorAgentTurnDto => ({
      id: `turn-${index}`,
      scope: { kind: 'DRAFT', id: 'draft-1' },
      mode: 'chat',
      prompt: index === 21 ? 'quiet pool portrait' : 'portrait',
      message: `message-${index}`,
      attachments:
        index === 21
          ? [
              {
                id: 'asset-reference',
                kind: 'REFERENCE',
                width: 1024,
                height: 1024,
                mimeType: 'image/png',
                mediaUrl: 'asset://asset-reference',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ]
          : [],
      result: normalizeAssistResult({ assistantMessage: `reply-${index}` }, 'portrait'),
      createdAt: '2026-01-01T00:00:00.000Z',
    }));

    const payload = buildCodexAssistCreatorPayload({ ...input, mode: 'chat', message: 'continue' }, history);

    expect(payload.conversation).toHaveLength(20);
    expect(payload.conversation[0]?.creatorMessage).toBe('message-2');
    expect(payload.conversation.at(-1)).toMatchObject({
      creatorMessage: 'message-21',
      attachmentAssetIds: ['asset-reference'],
      assistantMessage: 'reply-21',
      proposedPrompt: 'portrait',
    });
  });

  it('drops directions that cannot become an authorized experiment slot', () => {
    const normalized = normalizeAssistResult(
      {
        directions: [
          { label: '', prompt: 'portrait', rationale: 'test', variableAxis: 'light', risk: 'contrast' },
          { label: 'Warm light', prompt: '', rationale: 'test', variableAxis: 'light', risk: 'contrast' },
          { label: 'Cool light', prompt: 'cool portrait', rationale: 'test', variableAxis: 'light', risk: 'flat skin' },
        ],
      },
      'portrait',
    );

    expect(normalized.directions).toEqual([
      expect.objectContaining({
        label: 'Cool light',
        prompt: 'cool portrait',
        variableAxis: 'light',
        risk: 'flat skin',
      }),
    ]);
  });
});
