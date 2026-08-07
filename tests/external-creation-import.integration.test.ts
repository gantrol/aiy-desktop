import { describe, expect, it } from 'vitest';
import { createTestLibrary } from './support/test-library';

const onePixelPng = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);

function output(id: string, name = `${id}.png`) {
  return { id, name, mimeType: 'image/png' as const, bytes: onePixelPng };
}

describe('new external creation import', () => {
  it('atomically creates an exact external V01, outputs, and optional album ownership', () => {
    const library = createTestLibrary('aibd-new-external-creation-');
    try {
      const album = library.database.createAlbum({ title: 'External work' });
      const imported = library.database.importNewExternalCreation({
        intent: 'NEW_EXTERNAL_CREATION',
        sourceKind: 'EXTERNAL_IMPORT',
        albumId: album.id,
        title: '外部创作',
        prompt: { knowledge: 'EXACT', text: 'an exact external prompt' },
        source: 'UPLOAD',
        sourceUrl: 'https://example.com/output.png',
        outputs: [output('external-output')],
      });

      expect(imported).toMatchObject({
        albumId: album.id,
        assetIds: [expect.any(String)],
        importedOutputs: [{ promptVersionId: imported.versionId, generationText: 'an exact external prompt' }],
        duplicateCount: 0,
      });
      expect(
        library.database.db
          .prepare(
            `SELECT current_version_id currentVersionId, title FROM prompt_series WHERE id = ?`,
          )
          .get(imported.seriesId),
      ).toEqual({
        currentVersionId: imported.versionId,
        title: '外部创作',
      });
      expect(
        library.database.db
          .prepare(
            `SELECT version_no versionNo, user_intent userIntent,
        final_prompt finalPrompt, change_summary changeSummary, origin_type originType,
        prompt_knowledge promptKnowledge FROM prompt_versions WHERE id = ?`,
          )
          .get(imported.versionId),
      ).toEqual({
        versionNo: 1,
        userIntent: 'an exact external prompt',
        finalPrompt: 'an exact external prompt',
        changeSummary: 'EXTERNAL_IMPORT',
        originType: 'EXTERNAL_IMPORT',
        promptKnowledge: 'EXACT',
      });
      expect(
        library.database.db
          .prepare(
            `SELECT album_id albumId, target_type targetType,
        target_id targetId FROM album_members WHERE target_id = ? AND deleted_at IS NULL`,
          )
          .get(imported.seriesId),
      ).toEqual({
        albumId: album.id,
        targetType: 'SERIES',
        targetId: imported.seriesId,
      });
      expect(
        library.database.db
          .prepare(
            `SELECT COUNT(*) count FROM generation_runs
        WHERE prompt_version_id = ?`,
          )
          .get(imported.versionId),
      ).toEqual({ count: 0 });
    } finally {
      library.cleanup();
    }
  });

  it('creates a text-only MANUAL_PROMPT V01 with no imported outputs', () => {
    const library = createTestLibrary('aibd-manual-prompt-creation-');
    try {
      const created = library.database.importNewExternalCreation({
        intent: 'NEW_EXTERNAL_CREATION',
        sourceKind: 'MANUAL_PROMPT',
        title: '纯文本暂存',
        prompt: { knowledge: 'EXACT', text: 'text only prompt' },
        outputs: [],
      });

      expect(created).toMatchObject({ albumId: null, assetIds: [], importedOutputs: [], duplicateCount: 0 });
      expect(
        library.database.db
          .prepare(
            `SELECT origin_type originType, prompt_knowledge promptKnowledge,
        final_prompt finalPrompt FROM prompt_versions WHERE id = ?`,
          )
          .get(created.versionId),
      ).toEqual({
        originType: 'MANUAL_PROMPT',
        promptKnowledge: 'EXACT',
        finalPrompt: 'text only prompt',
      });
      expect(library.database.getWorkbench('en').series.find((series) => series.id === created.seriesId)).toMatchObject(
        { currentVersionId: created.versionId, versions: [{ versionNo: 1, runs: [] }] },
      );
    } finally {
      library.cleanup();
    }
  });

  it('consumes a manual working draft and rehomes its conversation to V01', () => {
    const library = createTestLibrary('aibd-manual-prompt-draft-');
    try {
      const draft = library.database.saveCreationDraft({
        id: null,
        title: '',
        text: 'working prompt',
        referenceAssetIds: [],
        termPromptLocale: 'en',
        termIds: [],
        wordPaletteReferences: [],
        canvasPresetKey: null,
        quality: 'low',
        selectedModelKeys: [],
        repeatCount: 1,
        modelTargets: [],
      });
      library.database.db
        .prepare(
          `INSERT INTO creator_agent_turns
        (id, scope_kind, scope_id, request_json, result_json, created_at)
        VALUES ('turn-1', 'DRAFT', ?, '{"mode":"chat","message":"refine it"}', '{}', '2026-01-01T00:00:00.000Z')`,
        )
        .run(draft.id);

      const created = library.database.importNewExternalCreation({
        intent: 'NEW_EXTERNAL_CREATION',
        sourceKind: 'MANUAL_PROMPT',
        creationDraftId: draft.id,
        title: '',
        prompt: { knowledge: 'EXACT', text: 'saved prompt' },
        outputs: [],
      });

      expect(
        library.database.db
          .prepare(
            `SELECT consumed_at consumedAt, source_series_id sourceSeriesId
        FROM creation_drafts WHERE id = ?`,
          )
          .get(draft.id),
      ).toEqual({
        consumedAt: expect.any(String),
        sourceSeriesId: created.seriesId,
      });
      expect(
        library.database.db
          .prepare(
            `SELECT scope_kind scopeKind, scope_id scopeId
        FROM creator_agent_turns WHERE id = 'turn-1'`,
          )
          .get(),
      ).toEqual({
        scopeKind: 'SERIES',
        scopeId: created.seriesId,
      });
    } finally {
      library.cleanup();
    }
  });

  it('records an unknown external Prompt without inventing Prompt text', () => {
    const library = createTestLibrary('aibd-unknown-external-prompt-');
    try {
      const created = library.database.importNewExternalCreation({
        intent: 'NEW_EXTERNAL_CREATION',
        title: '',
        prompt: { knowledge: 'UNKNOWN' },
        source: 'DROP',
        outputs: [output('unknown-prompt', 'inferred title.png')],
      });

      expect(
        library.database.db
          .prepare(
            `SELECT origin_type originType, prompt_knowledge promptKnowledge,
        user_intent userIntent, final_prompt finalPrompt FROM prompt_versions WHERE id = ?`,
          )
          .get(created.versionId),
      ).toEqual({
        originType: 'EXTERNAL_IMPORT',
        promptKnowledge: 'UNKNOWN',
        userIntent: '',
        finalPrompt: '',
      });
      expect(created.importedOutputs[0]).toMatchObject({
        promptVersionId: created.versionId,
        generationTextType: 'UNKNOWN',
        generationText: '',
        provenanceConfidence: 'UNKNOWN',
      });
    } finally {
      library.cleanup();
    }
  });

  it('rolls back all database rows when the requested album does not exist and keeps legacy import behavior', () => {
    const library = createTestLibrary('aibd-external-creation-rollback-');
    try {
      expect(() =>
        library.database.importNewExternalCreation({
          intent: 'NEW_EXTERNAL_CREATION',
          albumId: 'missing-album',
          title: '',
          prompt: { knowledge: 'UNKNOWN' },
          outputs: [output('rolled-back')],
        }),
      ).toThrow('Album not found');
      expect(library.database.db.prepare('SELECT COUNT(*) count FROM prompt_series').get()).toEqual({ count: 0 });
      expect(library.database.db.prepare('SELECT COUNT(*) count FROM prompt_versions').get()).toEqual({ count: 0 });
      expect(library.database.db.prepare('SELECT COUNT(*) count FROM creation_output_imports').get()).toEqual({
        count: 0,
      });

      const legacy = library.database.importCreatorOutputs({
        context: { seriesId: null, versionId: null, title: '', source: 'UPLOAD' },
        items: [output('legacy-output')],
      });
      expect(
        library.database.db
          .prepare(
            `SELECT current_version_id currentVersionId
        FROM prompt_series WHERE id = ?`,
          )
          .get(legacy.seriesId),
      ).toEqual({ currentVersionId: null });
      expect(legacy.importedOutputs[0].promptVersionId).toBeNull();
    } finally {
      library.cleanup();
    }
  });
});
