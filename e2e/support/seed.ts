import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { EditorialState, TermDraftInput } from '../../src/shared/contracts';
import { imageFixture } from '../../tests/support/fixtures';

export interface SeededTerm {
  id: string;
  stableKey: string;
  title: string;
  titleLocale: string;
  state: EditorialState;
}

export interface SeedTermOptions {
  title: string;
  titleLocale?: string;
  definition?: string;
  aliases?: string[];
  localizations?: TermDraftInput['localizations'];
  positive?: string;
  negative?: string;
  approved?: boolean;
}

/** Seed only the state owned by the journey. The behavior under test still goes through the UI. */
export async function seedTerm(page: Page, options: SeedTermOptions): Promise<SeededTerm> {
  return page.evaluate(
    async (input) => {
      const created = await window.desktopApi.dictionaryCreate({
        title: input.title,
        titleLocale: input.titleLocale,
        uiLocale: 'en',
      });
      let classificationId: string | null = null;
      if (input.approved) {
        let tree = await window.desktopApi.dictionaryClassificationsTree('en');
        if (!tree.nodes.length) {
          tree = await window.desktopApi.dictionaryClassificationCreate({
            parentId: null,
            name: 'E2E classification',
            nameLocale: 'en',
            localizations: [],
            locale: 'en',
          });
        }
        classificationId = tree.nodes.find((node) => node.state === 'ACTIVE')?.id ?? null;
        if (!classificationId) throw new Error('E2E term seed requires an active dictionary classification');
      }
      const draft: TermDraftInput = {
        termId: created.id,
        title: input.title,
        titleLocale: input.titleLocale,
        definition: input.definition || (input.approved ? 'E2E fixture definition.' : ''),
        aliases: input.aliases,
        localizations: input.localizations,
        classificationIds: classificationId ? [classificationId] : [],
        primaryDirectoryClassificationId: classificationId,
        expressions:
          input.positive || input.approved
            ? [
                {
                  contextKey: 'legacy.unspecified',
                  modelKey: 'gpt-image-2',
                  locale: input.titleLocale,
                  positive: input.positive || input.title,
                  negative: input.negative,
                },
              ]
            : [],
      };
      let saved = await window.desktopApi.dictionarySaveDraft({ draft, locale: 'en' });
      if (input.approved) saved = await window.desktopApi.dictionaryApprove(created.id, 'en');
      return {
        id: saved.id,
        stableKey: saved.stableKey,
        title: saved.title,
        titleLocale: saved.titleLocale,
        state: saved.editorialState,
      };
    },
    {
      ...options,
      titleLocale: options.titleLocale ?? 'en',
      definition: options.definition ?? '',
      aliases: options.aliases ?? [],
      localizations: options.localizations ?? [],
      positive: options.positive ?? '',
      negative: options.negative ?? '',
      approved: options.approved ?? false,
    },
  );
}

/** Adds one local, deterministic image so the no-network replay model is available. */
export async function seedReplayImage(page: Page, fixtureName = 'valid-64x64.png') {
  const bytes = Array.from(readFileSync(imageFixture(fixtureName)));
  return page.evaluate(
    async ({ imageBytes, name }) =>
      window.desktopApi.intakeCommit({
        intent: 'IMPORT',
        source: 'UPLOAD',
        albumId: null,
        items: [
          {
            id: `e2e-replay-${name}`,
            kind: 'IMAGE',
            name,
            mimeType: 'image/png',
            bytes: new Uint8Array(imageBytes),
          },
        ],
      }),
    { imageBytes: bytes, name: fixtureName },
  );
}

/** Adds a small deterministic image batch with user-visible names. */
export async function seedMaterialImages(page: Page, names: string[]) {
  const baseBytes = Array.from(readFileSync(imageFixture('valid-64x64.png')));
  return page.evaluate(
    async ({ base, imageNames }) =>
      window.desktopApi.intakeCommit({
        intent: 'IMPORT',
        source: 'UPLOAD',
        albumId: null,
        items: imageNames.map((name, index) => {
          const bytes = new Uint8Array(base.length + 4);
          bytes.set(base);
          new DataView(bytes.buffer).setUint32(base.length, index + 10_000, false);
          return {
            id: `e2e-material-${index}`,
            kind: 'IMAGE' as const,
            name,
            mimeType: 'image/png' as const,
            bytes,
          };
        }),
      }),
    { base: baseBytes, imageNames: names },
  );
}

/** Builds gallery volume through the public IPC boundary without driving repetitive UI. */
export async function seedMaterialVolume(page: Page, count: number) {
  const baseBytes = Array.from(readFileSync(imageFixture('valid-64x64.png')));
  return page.evaluate(
    async ({ base, materialCount }) => {
      const startedAt = performance.now();
      const batchSize = 16;
      for (let start = 0; start < materialCount; start += batchSize) {
        const items = Array.from({ length: Math.min(batchSize, materialCount - start) }, (_, offset) => {
          const index = start + offset;
          const bytes = new Uint8Array(base.length + 4);
          bytes.set(base);
          new DataView(bytes.buffer).setUint32(base.length, index, false);
          return {
            id: `e2e-volume-${index}`,
            kind: 'IMAGE' as const,
            name: `volume-${String(index).padStart(5, '0')}.png`,
            mimeType: 'image/png' as const,
            bytes,
          };
        });
        await window.desktopApi.intakeCommit({
          intent: 'IMPORT',
          source: 'UPLOAD',
          albumId: null,
          items,
        });
      }
      return { count: materialCount, durationMs: performance.now() - startedAt };
    },
    { base: baseBytes, materialCount: count },
  );
}

export interface SeedCreationOptions {
  title: string;
  prompt: string;
  termIds?: string[];
  referenceAssetIds?: string[];
}

export async function seedCreation(page: Page, options: SeedCreationOptions) {
  return page.evaluate(
    async (input) => {
      const draft = await window.desktopApi.creationDraftStart({ albumId: null, termPromptLocale: 'en' });
      const promptNodes = [
        { kind: 'TEXT' as const, text: input.prompt },
        ...input.termIds.map((termId) => ({ kind: 'TERM' as const, termId, promptLocale: 'en' as const })),
      ];
      return window.desktopApi.creationDraftCommit({
        creationDraftId: draft.id,
        title: input.title,
        manualPrompt: input.prompt,
        promptNodes,
        prompt: input.prompt,
        changeSummary: 'E2E fixture',
        referenceAssetIds: input.referenceAssetIds,
        termPromptLocale: 'en',
        termIds: input.termIds,
        wordPaletteReferences: [],
      });
    },
    {
      title: options.title,
      prompt: options.prompt,
      termIds: options.termIds ?? [],
      referenceAssetIds: options.referenceAssetIds ?? [],
    },
  );
}

/** Builds a large creation history through the same typed preload APIs as the UI. */
export async function seedCreationVolume(page: Page, count: number) {
  return page.evaluate(async (creationCount) => {
    const startedAt = performance.now();
    const seriesIds: string[] = [];
    for (let index = 0; index < creationCount; index += 1) {
      const suffix = String(index).padStart(4, '0');
      const title = `E2E Creation Volume ${suffix}`;
      const prompt = `Local volume prompt ${suffix}`;
      const draft = await window.desktopApi.creationDraftStart({ albumId: null, termPromptLocale: 'en' });
      const committed = await window.desktopApi.creationDraftCommit({
        creationDraftId: draft.id,
        title: title,
        manualPrompt: prompt,
        promptNodes: [{ kind: 'TEXT', text: prompt }],
        prompt,
        changeSummary: 'E2E volume fixture',
        referenceAssetIds: [],
        termPromptLocale: 'en',
        termIds: [],
        wordPaletteReferences: [],
      });
      seriesIds.push(committed.seriesId);
    }
    return {
      count: creationCount,
      durationMs: performance.now() - startedAt,
      firstSeriesId: seriesIds[0] ?? null,
      lastSeriesId: seriesIds.at(-1) ?? null,
    };
  }, count);
}
