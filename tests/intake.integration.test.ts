import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../src/main/database';

const roots: string[] = [];
const pngHeader = Buffer.alloc(24);
Buffer.from('89504e470d0a1a0a', 'hex').copy(pngHeader);
pngHeader.writeUInt32BE(1, 16);
pngHeader.writeUInt32BE(1, 20);
const png = new Uint8Array(pngHeader);

function openEmptyDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-intake-test-'));
  roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  database.initialize('空白资料库');
  return database;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('library intake', () => {
  it('starts empty and favorites text and images idempotently', async () => {
    const database = openEmptyDatabase();
    expect(database.getLibraryName()).toBe('空白资料库');
    expect(database.isLibraryEmpty()).toBe(true);

    const input = {
      intent: 'IMPORT' as const,
      source: 'PASTE' as const,
      favorite: true,
      items: [
        { id: 'text-1', kind: 'TEXT' as const, text: '雨夜车站的冷暖光' },
        {
          id: 'image-1',
          kind: 'IMAGE' as const,
          name: 'reference.png',
          mimeType: 'image/png' as const,
          bytes: png,
          sourceUrl: 'https://example.com/reference.png',
        },
        {
          id: 'image-2',
          kind: 'IMAGE' as const,
          name: 'same-reference.png',
          mimeType: 'image/png' as const,
          bytes: png,
        },
      ],
    };
    const firstCommit = await database.commitIntake(input);
    expect(firstCommit.favoriteCount).toBe(2);
    expect(firstCommit.materialIds).toHaveLength(2);
    expect(firstCommit.imageMaterialIds).toHaveLength(1);
    expect((await database.commitIntake(input)).favoriteCount).toBe(0);
    expect(database.isLibraryEmpty()).toBe(false);
    expect(database.listFavoriteTexts()).toMatchObject([{ text: '雨夜车站的冷暖光' }]);
    const gallery = database.listGallery({
      locale: 'zh',
      source: 'FAVORITE',
      unratedDimensions: [],
      cursor: null,
      limit: 20,
    });
    expect(gallery.total).toBe(1);
    expect(gallery.items[0]).toMatchObject({
      source: 'FAVORITE',
      favorite: { materialId: expect.any(String) },
      metadata: {
        originalName: 'reference.png',
        displayName: 'reference.png',
        sourceUrl: 'https://example.com/reference.png',
        aiGeneratedStatus: 'UNKNOWN',
      },
    });
    const materialId = gallery.items[0].materialId!;
    expect(
      database.updateMaterialMetadata({
        materialId,
        displayName: 'Beach portrait reference',
        note: 'Keep the cool blue palette',
        sourceUrl: 'https://example.com/reference.png',
        aiGeneratedStatus: 'YES',
        modelKey: null,
        modelName: 'External Image Model',
        modelProvider: 'Example',
        modelVersion: '2',
        generationTextType: 'EXACT_PROMPT',
        generationText: 'A quiet poolside portrait',
      }),
    ).toMatchObject({
      displayName: 'Beach portrait reference',
      modelName: 'External Image Model',
      provenanceConfidence: 'DECLARED',
    });
    expect(
      database.listGallery({ locale: 'zh', source: 'FAVORITE', unratedDimensions: [], cursor: null, limit: 20 })
        .items[0].metadata,
    ).toMatchObject({ displayName: 'Beach portrait reference', generationText: 'A quiet poolside portrait' });
    database.close();
  });

  it('persists an intake creation draft and consumes it with the first generation', async () => {
    const database = openEmptyDatabase();
    const committed = await database.commitIntake({
      intent: 'START_CREATION',
      source: 'DROP',
      items: [
        { id: 'text-1', kind: 'TEXT', text: '保留构图，改成雨天' },
        { id: 'image-1', kind: 'IMAGE', name: 'reference.png', mimeType: 'image/png', bytes: png },
      ],
    });
    expect(committed.draft).toMatchObject({ text: '保留构图，改成雨天', referenceAssets: [{ width: 1, height: 1 }] });
    expect(committed.materialIds).toEqual(committed.imageMaterialIds);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM materials WHERE kind = 'TEXT'").get()).toEqual({
      count: 0,
    });
    expect(database.getCreationDraft()?.id).toBe(committed.draft?.id);

    const assistantRun = database.startAssistantRun(
      {
        scope: { kind: 'DRAFT', id: committed.draft!.id },
        mode: 'directions',
        prompt: committed.draft!.text,
        locale: 'zh',
        directTerms: [],
        recipes: [],
        contextKey: 'draft-context-v1',
        referenceAssets: [],
        termPromptLocale: 'zh',
        canvasPresetKey: 'portrait_2_3',
        canvasWidth: 1024,
        canvasHeight: 1536,
        generationTargets: [{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }],
      },
      'sha256:draft-context-v1',
      {
        directTermCount: 0,
        recipeCount: 0,
        referenceCount: 0,
        visionAnalyzed: false,
      },
    );
    const frozenAssistantRequest = (
      database.db
        .prepare(
          `SELECT request_json FROM assistant_runs
      WHERE id = ?`,
        )
        .get(assistantRun.id) as { request_json: string }
    ).request_json;
    database.db
      .prepare(
        `INSERT INTO style_exploration_batches
      (id, scope_kind, scope_id, source_assistant_run_id, common_constraints_json, created_at, updated_at)
      VALUES ('draft-exploration', 'DRAFT', ?, ?, '[]', '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z')`,
      )
      .run(committed.draft!.id, assistantRun.id);

    const generation = database.prepareGeneration({
      seriesId: null,
      creationDraftId: committed.draft!.id,
      title: '雨天改图',
      manualPrompt: committed.draft!.text,
      prompt: committed.draft!.text,
      changeSummary: '',
      referenceAssetIds: committed.draft!.referenceAssets.map((asset: { id: string }) => asset.id),
      termPromptLocale: 'zh',
      termIds: [],
      wordPaletteReferences: [],
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'low',
    });
    expect(generation.seriesId).toBeTruthy();
    expect(database.getCreationDraft()).toBeNull();
    expect(
      database.db
        .prepare('SELECT source_series_id sourceSeriesId FROM creation_drafts WHERE id = ?')
        .get(committed.draft!.id),
    ).toEqual({ sourceSeriesId: generation.seriesId });
    expect(
      database.db
        .prepare(
          `SELECT scope_kind scopeKind, scope_id scopeId, request_json requestJson
      FROM assistant_runs WHERE id = ?`,
        )
        .get(assistantRun.id),
    ).toEqual({
      scopeKind: 'SERIES',
      scopeId: generation.seriesId,
      requestJson: frozenAssistantRequest,
    });
    expect(
      database.db
        .prepare(
          `SELECT scope_kind scopeKind, scope_id scopeId
      FROM style_exploration_batches WHERE id = 'draft-exploration'`,
        )
        .get(),
    ).toEqual({
      scopeKind: 'SERIES',
      scopeId: generation.seriesId,
    });
    expect(
      database.db
        .prepare(
          `SELECT entity_type entityType, operation FROM change_events
      WHERE operation = 'REHOME_SCOPE' ORDER BY entity_type`,
        )
        .all(),
    ).toEqual([
      { entityType: 'ASSISTANT_RUN', operation: 'REHOME_SCOPE' },
      { entityType: 'STYLE_EXPLORATION_BATCH', operation: 'REHOME_SCOPE' },
    ]);
    database.close();
  });

  it('keeps a text-only creation paste as a prompt draft without creating material data', async () => {
    const database = openEmptyDatabase();
    const committed = await database.commitIntake({
      intent: 'START_CREATION',
      source: 'PASTE',
      items: [{ id: 'text-1', kind: 'TEXT', text: '  主角级萌系角色，繁而有序  ' }],
    });

    expect(committed).toMatchObject({
      intent: 'START_CREATION',
      materialIds: [],
      imageMaterialIds: [],
      draft: { text: '主角级萌系角色，繁而有序', referenceAssets: [] },
    });
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM materials').get()).toEqual({ count: 0 });
    database.close();
  });

  it('soft-deletes favorites idempotently and allows favoriting them again', async () => {
    const database = openEmptyDatabase();
    const input = {
      intent: 'IMPORT' as const,
      source: 'PASTE' as const,
      favorite: true,
      items: [
        { id: 'text-1', kind: 'TEXT' as const, text: '可取消收藏的文字' },
        { id: 'image-1', kind: 'IMAGE' as const, name: 'favorite.png', mimeType: 'image/png' as const, bytes: png },
      ],
    };
    const committed = await database.commitIntake(input);
    const [textMaterialId, imageMaterialId] = committed.materialIds;

    expect(database.removeFavorite(textMaterialId)).toBe(true);
    expect(database.removeFavorite(textMaterialId)).toBe(false);
    expect(database.listFavoriteTexts()).toEqual([]);
    expect(database.removeFavorite(imageMaterialId)).toBe(true);
    expect(
      database.listGallery({ locale: 'zh', source: 'FAVORITE', unratedDimensions: [], cursor: null, limit: 20 }),
    ).toMatchObject({ total: 0, items: [] });
    expect(
      database.db
        .prepare(
          `SELECT count(*) AS count FROM tombstones
      WHERE entity_type = 'MATERIAL_FAVORITE'`,
        )
        .get(),
    ).toEqual({ count: 2 });

    expect((await database.commitIntake(input)).favoriteCount).toBe(2);
    expect(database.listFavoriteTexts()).toMatchObject([{ id: textMaterialId, text: '可取消收藏的文字' }]);
    expect(
      database.listGallery({ locale: 'zh', source: 'FAVORITE', unratedDimensions: [], cursor: null, limit: 20 }).total,
    ).toBe(1);
    database.close();
  });
});
