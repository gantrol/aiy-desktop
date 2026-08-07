import { describe, expect, it } from 'vitest';
import type { CreatorAgentAssistInput } from '../src/shared/contracts';
import {
  buildCreatorAssistantContextKey,
  creatorAssistantEnvironmentMatches,
  resolveCreatorPrompt,
} from '../src/renderer/components/creator/utils';

const frozen: CreatorAgentAssistInput = {
  scope: { kind: 'DRAFT', id: 'draft-1' },
  mode: 'directions',
  prompt: 'quiet portrait',
  locale: 'en',
  directTerms: [],
  recipes: [],
  referenceAssets: [],
  termPromptLocale: 'en',
  canvasPresetKey: 'square',
  canvasWidth: 1024,
  canvasHeight: 1024,
  generationTargets: [{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }],
  contextKey: 'frozen-context',
};

function current(overrides: Partial<Parameters<typeof creatorAssistantEnvironmentMatches>[1]> = {}) {
  return {
    context: { prompt: 'edited portrait', locale: 'en' as const, directTerms: [], recipes: [] },
    referenceAssets: [],
    termPromptLocale: 'en' as const,
    canvasPresetKey: 'square',
    canvasWidth: 1024,
    canvasHeight: 1024,
    generationTargets: [{ modelKey: 'gpt-image-2', count: 1, quality: 'low' as const }],
    ...overrides,
  };
}

describe('assistant frozen creator context', () => {
  it('allows an explicit prompt edit without re-authorizing changed settings', () => {
    expect(creatorAssistantEnvironmentMatches(frozen, current())).toBe(true);
    expect(
      creatorAssistantEnvironmentMatches(
        frozen,
        current({
          generationTargets: [{ modelKey: 'gpt-image-2', count: 2, quality: 'low' }],
        }),
      ),
    ).toBe(false);
    expect(
      creatorAssistantEnvironmentMatches(
        frozen,
        current({
          canvasWidth: 4096,
          canvasHeight: 256,
        }),
      ),
    ).toBe(false);
  });

  it('includes exact canvas dimensions in the visible-state fingerprint', () => {
    const resolution = resolveCreatorPrompt({
      manualPrompt: 'quiet portrait',
      selectedTerms: [],
      appliedPalettes: [],
    });
    const square = buildCreatorAssistantContextKey({
      resolution,
      referenceAssets: [],
      canvasPresetKey: 'square',
      canvasWidth: 1024,
      canvasHeight: 1024,
      generationTargets: frozen.generationTargets,
    });
    const tampered = buildCreatorAssistantContextKey({
      resolution,
      referenceAssets: [],
      canvasPresetKey: 'square',
      canvasWidth: 4096,
      canvasHeight: 256,
      generationTargets: frozen.generationTargets,
    });

    expect(tampered).not.toBe(square);
  });
});
