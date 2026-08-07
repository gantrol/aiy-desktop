import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../src/main/database';
import { resolveTermContent, resolveTermExpression, termFacetValueIds } from '../src/shared/term-localization';
import { importSyntheticLibrary } from './support/synthetic-library';

const roots: string[] = [];
const databases: LibraryDatabase[] = [];
let templateRoot = '';
let templateDatabasePath = '';
let databaseSequence = 0;

beforeAll(() => {
  templateRoot = mkdtempSync(path.join(os.tmpdir(), 'aibd-test-template-'));
  templateDatabasePath = path.join(templateRoot, 'template.sqlite3');
  const database = new LibraryDatabase(templateDatabasePath, templateRoot);
  database.initialize();
  importSyntheticLibrary(database);
  database.close();
}, 30_000);

function openDatabase() {
  const root = path.join(templateRoot, `case-${++databaseSequence}`);
  mkdirSync(root, { recursive: true });
  symlinkSync(path.join(templateRoot, 'objects'), path.join(root, 'objects'), 'junction');
  copyFileSync(templateDatabasePath, path.join(root, 'library.sqlite3'));
  roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // Individual tests may already have closed the handle.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  if (templateRoot) rmSync(templateRoot, { recursive: true, force: true });
});

describe('local library', { timeout: 15_000 }, () => {
  it('soft-deletes result series and album containers without deleting their history or contents', () => {
    const database = openDatabase();

    database.deletePromptSeries({ seriesId: 'ps_007', outputDisposition: 'KEEP' });
    expect(database.getWorkbench().series.some((series) => series.id === 'ps_007')).toBe(false);
    expect(
      database.db.prepare('SELECT deleted_at deletedAt FROM prompt_series WHERE id = ?').get('ps_007'),
    ).toMatchObject({ deletedAt: expect.any(String) });
    expect(database.db.prepare('SELECT count(*) count FROM prompt_versions WHERE series_id = ?').get('ps_007')).toEqual(
      { count: 3 },
    );
    expect(database.listAlbums().find((album) => album.id === 'album_ivory')?.members).toEqual([]);
    expect(
      database.db
        .prepare("SELECT count(*) count FROM tombstones WHERE entity_type = 'PROMPT_SERIES' AND entity_id = ?")
        .get('ps_007'),
    ).toEqual({ count: 1 });
    expect(database.getAssetPath('img_018')).toEqual(expect.any(String));

    database.deleteAlbum('album_summer');
    expect(database.listAlbums().some((album) => album.id === 'album_summer')).toBe(false);
    expect(database.listAlbums().some((album) => album.id === 'album_ivory')).toBe(true);
    expect(
      database.db.prepare('SELECT count(*) count FROM album_members WHERE album_id = ?').get('album_summer'),
    ).toEqual({ count: 4 });
    expect(
      database.db
        .prepare("SELECT count(*) count FROM tombstones WHERE entity_type = 'ALBUM' AND entity_id = ?")
        .get('album_summer'),
    ).toEqual({ count: 1 });
    expect(() => database.deletePromptSeries({ seriesId: 'ps_007', outputDisposition: 'KEEP' })).toThrow(
      'Prompt series not found',
    );
    database.close();
  });

  it('keeps output assets discoverable in materials when deleting only their creation', () => {
    const database = openDatabase();
    const sourcePath = database.getAssetPath('img_011');
    expect(sourcePath).toEqual(expect.any(String));
    const generation = database.prepareGeneration({
      seriesId: null,
      title: '仅删除创作',
      manualPrompt: 'portrait',
      prompt: 'portrait',
      changeSummary: '',
      referenceAssetIds: [],
      termIds: [],
      wordPaletteReferences: [],
      termPromptLocale: 'en',
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'low',
    });
    const output = database.finishGeneration(generation.runId, sourcePath!);

    expect(
      database
        .listGallery({
          locale: 'zh',
          source: 'CREATION',
          unratedDimensions: [],
          cursor: null,
          limit: 60,
        })
        .items.map((item) => item.asset.id),
    ).toContain(output.id);
    expect(database.deletePromptSeries({ seriesId: generation.seriesId, outputDisposition: 'KEEP' })).toEqual({
      seriesId: generation.seriesId,
      outputDisposition: 'KEEP',
      trashedOutputCount: 0,
      retainedOutputCount: 0,
    });

    expect(database.getAssetPath(output.id)).toEqual(expect.any(String));
    expect(
      database
        .listGallery({
          locale: 'zh',
          source: 'ALL',
          unratedDimensions: [],
          cursor: null,
          limit: 60,
        })
        .items.find((item) => item.asset.id === output.id),
    ).toMatchObject({ source: 'MATERIAL', creation: null });
    expect(
      database
        .listGallery({
          locale: 'zh',
          source: 'CREATION',
          unratedDimensions: [],
          cursor: null,
          limit: 60,
        })
        .items.map((item) => item.asset.id),
    ).not.toContain(output.id);
    database.close();
  });

  it('trashes unreferenced outputs when deleting their creation', () => {
    const database = openDatabase();
    const sourcePath = database.getAssetPath('img_011');
    expect(sourcePath).toEqual(expect.any(String));
    const generation = database.prepareGeneration({
      seriesId: null,
      title: '删除无引用产出',
      manualPrompt: 'portrait',
      prompt: 'portrait',
      changeSummary: '',
      referenceAssetIds: [],
      termIds: [],
      wordPaletteReferences: [],
      termPromptLocale: 'en',
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'low',
    });
    const output = database.finishGeneration(generation.runId, sourcePath!);

    expect(database.deletePromptSeries({ seriesId: generation.seriesId, outputDisposition: 'TRASH' })).toEqual({
      seriesId: generation.seriesId,
      outputDisposition: 'TRASH',
      trashedOutputCount: 1,
      retainedOutputCount: 0,
    });
    expect(database.getAssetPath(output.id)).toBeNull();
    expect(
      database.db
        .prepare("SELECT count(*) count FROM tombstones WHERE entity_type = 'IMAGE_ASSET' AND entity_id = ?")
        .get(output.id),
    ).toEqual({ count: 1 });
    database.close();
  });

  it('albums creation, recursive legacy albums, and dictionary domain branches as read-only material albums', () => {
    const database = openDatabase();
    const albums = database.listMaterialAlbums({ locale: 'zh' });
    const creationRoot = albums.find((album) => album.systemKey === 'CREATION_ROOT');
    const dictionary = albums.find((album) => album.systemKey === 'DICTIONARY');
    const dictionaryDomains = albums.filter((album) => album.systemKey === 'DICTIONARY_DOMAIN');
    const summer = albums.find((album) => album.sourceAlbumId === 'album_summer');
    const ivory = albums.find((album) => album.sourceAlbumId === 'album_ivory');

    expect(creationRoot).toMatchObject({ kind: 'SYSTEM', readOnly: true, parentId: null, title: '创作' });
    expect(dictionary).toMatchObject({ kind: 'SYSTEM', readOnly: true, parentId: null, title: '词典' });
    expect(dictionaryDomains.length).toBeGreaterThan(0);
    expect(dictionaryDomains.every((album) => album.parentId === dictionary?.id && album.readOnly)).toBe(true);
    expect(summer).toMatchObject({
      kind: 'SYSTEM',
      systemKey: 'CREATION_GROUP',
      readOnly: true,
      parentId: creationRoot?.id,
    });
    expect(ivory).toMatchObject({
      kind: 'SYSTEM',
      systemKey: 'CREATION_GROUP',
      readOnly: true,
      parentId: summer?.id,
    });
    expect(creationRoot!.materialCount).toBeGreaterThan(0);
    expect(dictionary!.materialCount).toBeGreaterThan(0);
    expect(dictionaryDomains.every((album) => album.materialCount > 0)).toBe(true);
    expect(summer!.materialCount).toBeGreaterThanOrEqual(ivory!.materialCount);
    expect(creationRoot!.previewAssets.length).toBeLessThanOrEqual(4);

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = database.listGallery({
        locale: 'zh',
        source: 'ALL',
        albumId: summer!.id,
        unratedDimensions: [],
        cursor,
        limit: 2,
      });
      expect(page.total).toBe(summer!.materialCount);
      ids.push(...page.items.map((item) => item.asset.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(summer!.materialCount);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('img_018');

    const dictionaryDomain = dictionaryDomains[0];
    const dictionaryDomainPage = database.listGallery({
      locale: 'zh',
      source: 'ALL',
      albumId: dictionaryDomain.id,
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    });
    expect(dictionaryDomainPage.total).toBe(dictionaryDomain.materialCount);
    expect(dictionaryDomainPage.items.length).toBeGreaterThan(0);
    expect(dictionaryDomainPage.items.every((item) => item.dictionary)).toBe(true);

    expect(() => database.renameMaterialAlbum({ albumId: creationRoot!.id, title: '不能改名' })).toThrow('read-only');
    expect(() => database.deleteMaterialAlbum(dictionary!.id)).toThrow('read-only');
    expect(() => database.deleteMaterialAlbum(dictionaryDomain.id)).toThrow('read-only');
    expect(() =>
      database.addMaterialAlbumMembers({
        albumId: summer!.id,
        targets: [{ kind: 'IMAGE_ASSET', imageAssetId: 'img_018' }],
      }),
    ).toThrow('read-only');
    database.close();
  }, 20_000);

  it('keeps user material-album membership stable, idempotent, and independent across albums', async () => {
    const database = openDatabase();
    await database.commitIntake({
      intent: 'IMPORT',
      source: 'PASTE',
      favorite: true,
      items: [{ id: 'album-text', kind: 'TEXT', text: '保留在素材图集中的文本' }],
    });
    const textMaterial = database.listFavoriteTexts().find((item) => item.text === '保留在素材图集中的文本');
    expect(textMaterial).toBeDefined();

    const first = database.createMaterialAlbum({ title: '灵感' });
    const second = database.createMaterialAlbum({ title: '灵感' });
    expect(first.id).not.toBe(second.id);
    const added = database.addMaterialAlbumMembers({
      albumId: first.id,
      targets: [
        { kind: 'IMAGE_ASSET', imageAssetId: 'img_018' },
        { kind: 'IMAGE_ASSET', imageAssetId: 'img_018' },
        { kind: 'IMAGE_ASSET', imageAssetId: 'img_011' },
        { kind: 'IMAGE_ASSET', imageAssetId: 'img_012' },
        { kind: 'IMAGE_ASSET', imageAssetId: 'ref_003' },
        { kind: 'MATERIAL', materialId: textMaterial!.id },
      ],
    });
    expect(added.materialCount).toBe(5);
    expect(added.members.map((member) => member.kind)).toEqual(['IMAGE', 'IMAGE', 'IMAGE', 'IMAGE', 'TEXT']);
    const imageMember = added.members.find((member) => member.imageAsset?.id === 'img_018')!;
    const memberIds = added.members.map((member) => member.id);

    const repeated = database.addMaterialAlbumMembers({
      albumId: first.id,
      targets: [
        { kind: 'IMAGE_ASSET', imageAssetId: 'img_018' },
        { kind: 'MATERIAL', materialId: textMaterial!.id },
      ],
    });
    expect(repeated.members.map((member) => member.id)).toEqual(memberIds);

    const crossAlbum = database.addMaterialAlbumMembers({
      albumId: second.id,
      targets: [{ kind: 'MATERIAL', materialId: imageMember.materialId }],
    });
    expect(crossAlbum.members[0].materialId).toBe(imageMember.materialId);
    expect(crossAlbum.members[0].id).not.toBe(imageMember.id);
    expect(database.renameMaterialAlbum({ albumId: second.id, title: '灵感' }).title).toBe('灵感');

    const galleryIds: string[] = [];
    let cursor: string | null = null;
    do {
      const page = database.listGallery({
        locale: 'zh',
        source: 'ALL',
        albumId: first.id,
        unratedDimensions: [],
        cursor,
        limit: 2,
      });
      expect(page.total).toBe(4);
      expect(page.items.every((item) => item.materialId)).toBe(true);
      galleryIds.push(...page.items.map((item) => item.asset.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(galleryIds)).toEqual(new Set(['img_018', 'img_011', 'img_012', 'ref_003']));
    expect(
      database
        .listGallery({
          locale: 'zh',
          source: 'ALL',
          albumId: first.id,
          unratedDimensions: [],
          cursor: null,
          limit: 60,
        })
        .items.find((item) => item.asset.id === 'ref_003'),
    ).toMatchObject({ source: 'MATERIAL' });
    const creationOnly = database.listGallery({
      locale: 'zh',
      source: 'CREATION',
      albumId: first.id,
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    });
    expect(creationOnly.total).toBe(3);
    expect(creationOnly.items.map((item) => item.asset.id)).not.toContain('ref_003');

    const removed = database.removeMaterialAlbumMembers({ albumId: first.id, materialIds: [imageMember.materialId] });
    expect(removed.materialCount).toBe(4);
    expect(removed.members.some((member) => member.id === imageMember.id)).toBe(false);
    const restored = database.addMaterialAlbumMembers({
      albumId: first.id,
      targets: [{ kind: 'IMAGE_ASSET', imageAssetId: 'img_018' }],
    });
    expect(restored.members.find((member) => member.materialId === imageMember.materialId)?.id).toBe(imageMember.id);
    expect(
      database.db
        .prepare(
          `SELECT count(*) count FROM tombstones
      WHERE entity_type = 'ALBUM_MEMBER' AND entity_id = ?`,
        )
        .get(imageMember.id),
    ).toEqual({ count: 1 });

    database.deleteMaterialAlbum(first.id);
    expect(database.listMaterialAlbums({ locale: 'zh' }).some((album) => album.id === first.id)).toBe(false);
    expect(
      database.db.prepare('SELECT deleted_at deletedAt FROM materials WHERE id = ?').get(imageMember.materialId),
    ).toEqual({ deletedAt: null });
    expect(database.db.prepare('SELECT count(*) count FROM album_members WHERE album_id = ?').get(first.id)).toEqual({
      count: 5,
    });
    expect(
      database.listGallery({
        locale: 'zh',
        source: 'ALL',
        albumId: first.id,
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      }).total,
    ).toBe(0);
    database.close();
  }, 20_000);

  it('retains outputs referenced by dictionary terms or material albums when deleting their creation', () => {
    const database = openDatabase();
    expect(database.getTerm('term_young_adult', 'zh').media.some((item) => item.asset.id === 'img_011')).toBe(true);
    const generatedPath = database.getAssetPath('img_011')!;
    const imported = database.importCreatorOutputs({
      context: {
        seriesId: 'ps_011',
        versionId: 'pv_011_02',
        title: '',
        source: 'UPLOAD',
      },
      items: [
        {
          id: 'delete-output-import',
          name: 'imported-output.png',
          mimeType: 'image/png',
          bytes: readFileSync(generatedPath),
        },
      ],
    });
    const importedOutput = imported.importedOutputs[0];
    const importedPath = database.getAssetPath(importedOutput.imageAssetId)!;
    const album = database.createMaterialAlbum({ title: '删除产出测试' });
    const albumBeforeDelete = database.addMaterialAlbumMembers({
      albumId: album.id,
      targets: [
        { kind: 'IMAGE_ASSET', imageAssetId: 'img_011' },
        { kind: 'IMAGE_ASSET', imageAssetId: importedOutput.imageAssetId },
      ],
    });
    const retainedMaterialIds = albumBeforeDelete.members.map((member) => member.materialId).sort();
    const retainedMemberIds = albumBeforeDelete.members.map((member) => member.id).sort();

    expect(database.deletePromptSeries({ seriesId: 'ps_011', outputDisposition: 'TRASH' })).toEqual({
      seriesId: 'ps_011',
      outputDisposition: 'TRASH',
      trashedOutputCount: 0,
      retainedOutputCount: 2,
    });

    expect(database.getAssetPath('img_011')).toEqual(expect.any(String));
    expect(database.getAssetPath(importedOutput.imageAssetId)).toEqual(expect.any(String));
    expect(existsSync(generatedPath)).toBe(true);
    expect(existsSync(importedPath)).toBe(true);
    expect(database.getTerm('term_young_adult', 'zh').media.some((item) => item.asset.id === 'img_011')).toBe(true);
    expect(
      database.db.prepare('SELECT deleted_at deletedAt FROM term_media_links WHERE image_asset_id = ?').get('img_011'),
    ).toEqual({ deletedAt: null });
    expect(database.db.prepare('SELECT deleted_at deletedAt FROM image_assets WHERE id = ?').get('img_011')).toEqual({
      deletedAt: null,
    });
    expect(
      database.db
        .prepare("SELECT count(*) count FROM tombstones WHERE entity_type = 'IMAGE_ASSET' AND entity_id = ?")
        .get('img_011'),
    ).toEqual({ count: 0 });
    expect(
      database.db
        .prepare('SELECT result_asset_id resultAssetId FROM generation_runs WHERE prompt_version_id = ?')
        .get('pv_011_02'),
    ).toEqual({ resultAssetId: 'img_011' });
    expect(
      database.db
        .prepare(
          `SELECT image_asset_id imageAssetId, deleted_at deletedAt
      FROM creation_output_imports WHERE id = ?`,
        )
        .get(importedOutput.id),
    ).toMatchObject({
      imageAssetId: importedOutput.imageAssetId,
      deletedAt: expect.any(String),
    });
    expect(
      database.db
        .prepare(
          `SELECT id, deleted_at deletedAt FROM materials
      WHERE id IN (?, ?) ORDER BY id`,
        )
        .all(...retainedMaterialIds) as Array<{ id: string; deletedAt: string | null }>,
    ).toEqual(retainedMaterialIds.map((id) => ({ id, deletedAt: null })));
    expect(
      database.db
        .prepare(
          `SELECT id, deleted_at deletedAt FROM album_members
      WHERE id IN (?, ?) ORDER BY id`,
        )
        .all(...retainedMemberIds) as Array<{ id: string; deletedAt: string | null }>,
    ).toEqual(retainedMemberIds.map((id) => ({ id, deletedAt: null })));
    expect(
      database.listGallery({
        locale: 'zh',
        source: 'ALL',
        albumId: album.id,
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      }).total,
    ).toBe(2);
    expect(
      database
        .listGallery({
          locale: 'zh',
          source: 'ALL',
          albumId: album.id,
          unratedDimensions: [],
          cursor: null,
          limit: 60,
        })
        .items.map((item) => item.materialId)
        .sort(),
    ).toEqual(retainedMaterialIds);
    database.close();
  });

  it('does not delete a result series with an active generation', () => {
    const database = openDatabase();
    const generation = database.prepareGeneration({
      seriesId: null,
      title: '生成中的成果',
      manualPrompt: 'portrait',
      prompt: 'portrait',
      changeSummary: '',
      referenceAssetIds: [],
      termIds: [],
      wordPaletteReferences: [],
      termPromptLocale: 'en',
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'low',
    });
    expect(() => database.deletePromptSeries({ seriesId: generation.seriesId, outputDisposition: 'KEEP' })).toThrow(
      'while it is generating',
    );
    expect(database.getWorkbench().series.some((series) => series.id === generation.seriesId)).toBe(true);
    database.close();
  });

  it('maintains ordered term covers and related images as syncable links', () => {
    const database = openDatabase();
    const term = database.createTerm({
      title: '图示测试',
      titleLocale: 'zh',
      uiLocale: 'zh',
    });
    expect(term.media).toEqual([]);

    let media = database.addTermMedia({ termId: term.id, assetIds: ['img_011', 'img_012', 'img_014'] });
    expect(media.map((item) => [item.role, item.asset.id])).toEqual([
      ['COVER', 'img_011'],
      ['RELATED', 'img_012'],
      ['RELATED', 'img_014'],
    ]);

    const nextCover = media.find((item) => item.asset.id === 'img_014')!;
    media = database.setTermMediaCover(nextCover.id);
    expect(media[0]).toMatchObject({ role: 'COVER', asset: { id: 'img_014' } });

    const swappedIds = [media[1].id, media[0].id, media[2].id];
    media = database.reorderTermMedia({ termId: term.id, mediaIds: swappedIds });
    expect(media.map((item) => item.id)).toEqual(swappedIds);
    expect(media[0].role).toBe('COVER');
    expect(media.slice(1).every((item) => item.role === 'RELATED')).toBe(true);

    const relatedIds = media
      .filter((item) => item.role === 'RELATED')
      .map((item) => item.id)
      .reverse();
    media = database.reorderTermMedia({ termId: term.id, mediaIds: [media[0].id, ...relatedIds] });
    expect(media.filter((item) => item.role === 'RELATED').map((item) => item.id)).toEqual(relatedIds);

    const removedId = media[0].id;
    media = database.removeTermMedia(removedId);
    expect(media).toHaveLength(2);
    expect(media[0].role).toBe('COVER');
    expect(media[1].role).toBe('RELATED');
    expect(
      database.db
        .prepare("SELECT count(*) count FROM tombstones WHERE entity_type = 'TERM_MEDIA_LINK' AND entity_id = ?")
        .get(removedId),
    ).toEqual({ count: 1 });
    expect(
      (
        database.db.prepare("SELECT count(*) count FROM change_events WHERE entity_type = 'TERM_MEDIA_LINK'").get() as {
          count: number;
        }
      ).count,
    ).toBeGreaterThanOrEqual(12);
    database.close();
  });

  it('repairs imported content only after an explicit re-import', () => {
    const database = openDatabase();
    database.db
      .prepare("UPDATE generation_runs SET prompt_version_id = 'pv_011_01' WHERE id IN ('run_011', 'run_012')")
      .run();
    database.db.prepare("UPDATE generation_runs SET prompt_version_id = 'pv_011_02' WHERE id = 'run_014'").run();
    database.close();

    const root = roots.at(-1)!;
    const reopened = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
    databases.push(reopened);
    reopened.initialize();
    const ownership = () =>
      reopened.db
        .prepare(
          `SELECT r.id, v.series_id AS seriesId
      FROM generation_runs r JOIN prompt_versions v ON v.id = r.prompt_version_id
      WHERE r.id IN ('run_011', 'run_012', 'run_014') ORDER BY r.id`,
        )
        .all();
    expect(ownership()).toEqual([
      { id: 'run_011', seriesId: 'ps_011' },
      { id: 'run_012', seriesId: 'ps_011' },
      { id: 'run_014', seriesId: 'ps_011' },
    ]);

    importSyntheticLibrary(reopened);
    expect(ownership()).toEqual([
      { id: 'run_011', seriesId: 'ps_011' },
      { id: 'run_012', seriesId: 'ps_012' },
      { id: 'run_014', seriesId: 'ps_014' },
    ]);
    reopened.close();
  });

  it('uses OR within one facet and AND across facets', () => {
    const database = openDatabase();
    const ids = (facetValueIds: string[]) =>
      database
        .searchTerms('zh', '', facetValueIds)
        .map((term) => term.id)
        .sort();

    // Result counts move with every dictionary content edit. The behaviour under
    // test is the set algebra, so assert that directly against the data instead
    // of pinning totals that only record what the corpus happened to contain.
    const appearance = ids(['fv_domain_appearance']);
    const accessories = ids(['fv_domain_accessories']);
    expect(appearance.length).toBeGreaterThan(0);
    expect(accessories.length).toBeGreaterThan(0);

    // Two values of the same facet (domain) combine as OR.
    expect(ids(['fv_domain_appearance', 'fv_domain_accessories'])).toEqual(
      [...new Set([...appearance, ...accessories])].sort(),
    );

    // Values from different facets combine as AND: a strict, non-empty subset.
    for (const [broad, narrow] of [
      [['fv_domain_accessories'], ['fv_domain_accessories', 'fv_subject_bag']],
      [['fv_domain_body'], ['fv_domain_body', 'fv_subject_shoulder_neck']],
      [['fv_domain_body'], ['fv_domain_body', 'fv_item_body_build']],
      [['fv_domain_body'], ['fv_domain_body', 'fv_item_standing_pose']],
    ]) {
      const broadIds = ids(broad);
      const narrowIds = ids(narrow);
      expect(narrowIds.length, narrow.join('+')).toBeGreaterThan(0);
      expect(narrowIds.length, narrow.join('+')).toBeLessThan(broadIds.length);
      expect(
        narrowIds.every((id) => broadIds.includes(id)),
        narrow.join('+'),
      ).toBe(true);
      // Every match genuinely carries both facet values, not just the first.
      for (const id of narrowIds) {
        expect(termFacetValueIds(database.getTerm(id, 'zh')), id).toEqual(expect.arrayContaining(narrow));
      }
    }

    const accessoryTerm = database.getTerm('term_compact_black_handbag', 'zh');
    expect(termFacetValueIds(accessoryTerm)).toEqual(['fv_domain_accessories', 'fv_subject_bag']);
    database.close();
  }, 15_000);

  it('returns stable dictionary pages with totals and an optional prioritized term', () => {
    const database = openDatabase();
    const input = {
      locale: 'zh' as const,
      query: '',
      facetValueIds: [],
      excludeDrafts: false,
      excludeUncited: false,
      includeArchived: false,
      limit: 3,
    };
    const first = database.searchTermsPage({ ...input, offset: 0 });
    const second = database.searchTermsPage({ ...input, offset: 3 });
    // Derived from the corpus: paging must agree with the unpaged query rather
    // than with a total that any dictionary edit invalidates.
    const totalTerms = database.searchTerms('zh').length;
    expect(totalTerms).toBeGreaterThan(6);
    expect(first).toMatchObject({ total: totalTerms, offset: 0, limit: 3, hasMore: true });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(3);
    expect(second.items.some((term) => first.items.some((firstTerm) => firstTerm.id === term.id))).toBe(false);
    expect([...first.items, ...second.items].map((term) => term.id)).toEqual(
      database
        .searchTerms('zh')
        .slice(0, 6)
        .map((term) => term.id),
    );

    // The last full page, wherever the corpus happens to end.
    const finalOffset = Math.max(0, totalTerms - 3);
    const final = database.searchTermsPage({ ...input, offset: finalOffset });
    expect(final.items).toHaveLength(Math.min(3, totalTerms - finalOffset));
    expect(final.hasMore).toBe(false);
    const prioritizedId = database.searchTerms('zh')[Math.floor(totalTerms / 2)]!.id;
    const prioritized = database.searchTermsPage({ ...input, offset: 0, prioritizeTermId: prioritizedId });
    expect(prioritized.items[0]?.id).toBe(prioritizedId);

    const filtered = database.searchTermsPage({
      ...input,
      offset: 0,
      facetValueIds: ['fv_domain_accessories', 'fv_subject_bag'],
    });
    const bagTermCount = database.searchTerms('zh', '', ['fv_domain_accessories', 'fv_subject_bag']).length;
    expect(bagTermCount).toBeGreaterThan(0);
    expect(bagTermCount).toBeLessThan(40);
    expect(filtered.total).toBe(bagTermCount);
    expect(filtered.items).toHaveLength(bagTermCount);
    expect(filtered.hasMore).toBe(false);

    const uncategorized = database.searchTermsPage({
      ...input,
      offset: 0,
      limit: 20,
      missingFacetSystemRoles: ['PRIMARY_CLASSIFICATION'],
    });
    expect(uncategorized.items).toHaveLength(Math.min(20, uncategorized.total));
    expect(uncategorized.items.every((term) => term.classifications.length === 0)).toBe(true);
    database.close();
  }, 15_000);

  it('filters draft and uncited terms independently', () => {
    const database = openDatabase();
    const withoutDrafts = database.searchTerms('zh', '', [], { excludeDrafts: true, excludeUncited: false });
    const citedOnly = database.searchTerms('zh', '', [], { excludeDrafts: false, excludeUncited: true });
    expect(withoutDrafts.length).toBeGreaterThan(0);
    expect(withoutDrafts.every((term) => term.editorialState !== 'DRAFT')).toBe(true);
    expect(citedOnly.length).toBeGreaterThan(0);
    expect(citedOnly.every((term) => term.metrics.citationCount > 0)).toBe(true);
    database.close();
  });

  it('restores fixture citations in an existing local library', () => {
    const database = openDatabase();
    database.db
      .prepare("DELETE FROM prompt_term_bindings WHERE id IN ('ptb_001', 'ptb_002', 'ptb_003', 'ptb_004', 'ptb_005')")
      .run();
    database.close();

    const root = roots.at(-1)!;
    const reopened = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
    databases.push(reopened);
    reopened.initialize();
    importSyntheticLibrary(reopened);
    expect(reopened.db.prepare("SELECT count(*) count FROM prompt_term_bindings WHERE id LIKE 'ptb_%'").get()).toEqual({
      count: 5,
    });
    reopened.close();
  });

  it('keeps approved revisions immutable while promoting a draft', () => {
    const database = openDatabase();
    const original = database.getTerm('term_young_adult', 'zh');
    database.saveTermDraft(
      {
        ...original,
        termId: original.id,
        title: '清新年轻成人特征',
      },
      'zh',
    );
    const approved = database.approveTerm('term_young_adult', 'zh');
    expect(approved.title).toBe('清新年轻成人特征');
    expect(approved.revisionNo).toBe(original.revisionNo + 1);
    const count = database.db
      .prepare('SELECT count(*) count FROM term_revisions WHERE term_id = ?')
      .get(original.id) as { count: number };
    expect(count.count).toBe(2);
    database.close();
  });

  it('stages imports as local drafts', () => {
    const database = openDatabase();
    const preview = database.stageImport('sample.csv', [
      {
        stableKey: 'clothing.silk_ribbon',
        title: '真丝发带',
        titleLocale: 'zh',
        definition: '柔软、低光泽的真丝发带。',
        localizations: [
          {
            locale: 'en',
            title: 'Silk hair ribbon',
            definition: 'Soft silk hair ribbon with low sheen.',
            aliases: [],
          },
        ],
        classificationKeys: ['gamma'],
        primaryDirectoryClassificationKey: 'gamma',
        expressions: [
          {
            contextKey: 'general.default',
            modelKey: 'gpt-image-2',
            locale: 'en',
            positive: 'soft silk hair ribbon with low sheen',
            negative: '',
          },
        ],
      },
    ]);
    expect(preview.valid).toBe(1);
    expect(database.commitImport(preview.batchId).imported).toBe(1);
    const imported = database.searchTerms('zh', '真丝发带');
    expect(imported[0].editorialState).toBe('DRAFT');
    expect(termFacetValueIds(imported[0])).toEqual(['fv_domain_clothing']);
    database.close();
  });

  it('creates, edits, and approves a new dictionary term', () => {
    const database = openDatabase();
    const created = database.createTerm({
      title: '心形脸',
      titleLocale: 'zh',
      uiLocale: 'zh',
    });
    expect(created.editorialState).toBe('DRAFT');
    expect(created.hasDraft).toBe(true);
    const classificationId = database.getCategories('zh')[0]!.id;

    database.saveTermDraft(
      {
        termId: created.id,
        title: created.title,
        titleLocale: created.titleLocale,
        definition: '额头略宽、下巴收窄的脸型。',
        aliases: ['倒三角脸'],
        localizations: [
          {
            locale: 'en',
            title: 'Heart-shaped face',
            definition: 'A face shape with a broader forehead and tapered chin.',
            aliases: [],
          },
        ],
        classificationIds: [classificationId],
        primaryDirectoryClassificationId: classificationId,
        expressions: [
          {
            contextKey: 'general.default',
            modelKey: 'gpt-image-2',
            locale: 'en',
            positive: 'heart-shaped face, tapered chin',
            negative: '',
          },
        ],
      },
      'zh',
    );
    const approved = database.approveTerm(created.id, 'zh');
    expect(approved.editorialState).toBe('APPROVED');
    expect(approved.hasDraft).toBe(false);
    expect(approved.definition).toContain('额头略宽');
    expect(database.searchTerms('zh', '倒三角脸').some((term) => term.id === created.id)).toBe(true);
    database.close();
  });

  it('persists and searches multiple arbitrary-language localizations and expressions', () => {
    const database = openDatabase();
    const created = database.createTerm({ title: '多语言词条', titleLocale: 'zh', uiLocale: 'zh' });
    const classificationId = database.getCategories('zh')[0]!.id;

    database.saveTermDraft(
      {
        termId: created.id,
        title: created.title,
        titleLocale: created.titleLocale,
        definition: '验证开放语言代码的词条。',
        aliases: ['多语词'],
        localizations: [
          {
            locale: 'en',
            title: 'Multilingual term',
            definition: 'A term with open-ended language support.',
            aliases: ['multilingual entry'],
          },
          { locale: 'ja', title: '多言語用語', definition: '多言語対応を検証する用語。', aliases: ['多言語項目'] },
          {
            locale: 'fr',
            title: 'Terme multilingue',
            definition: 'Un terme avec plusieurs langues.',
            aliases: ['entrée multilingue'],
          },
        ],
        classificationIds: [classificationId],
        primaryDirectoryClassificationId: classificationId,
        expressions: [
          {
            contextKey: 'general.default',
            modelKey: 'gpt-image-2',
            locale: 'en',
            positive: 'multilingual visual term',
            negative: '',
          },
          {
            contextKey: 'general.default',
            modelKey: 'gpt-image-2',
            locale: 'ja',
            positive: '多言語の視覚表現',
            negative: '',
          },
        ],
      },
      'zh',
    );

    const approved = database.approveTerm(created.id, 'zh');
    expect(approved.editorialState).toBe('APPROVED');
    expect(approved.localizations.map((item) => item.locale)).toEqual(['en', 'fr', 'ja']);
    expect(resolveTermContent(approved, 'ja')).toMatchObject({ title: '多言語用語', aliases: ['多言語項目'] });
    expect(approved.modelExpressions.map((item) => [item.modelKey, item.locale, item.positive])).toEqual([
      ['gpt-image-2', 'en', 'multilingual visual term'],
      ['gpt-image-2', 'ja', '多言語の視覚表現'],
    ]);
    expect(database.searchTerms('zh', 'Terme multilingue').map((item) => item.id)).toContain(created.id);
    expect(database.searchTerms('zh', '多言語項目').map((item) => item.id)).toContain(created.id);
    database.close();
  });

  it('keeps model expressions isolated by explicit context profile', () => {
    const database = openDatabase();
    const classificationId = database.getCategories('en')[0]!.id;
    const created = database.createTerm({ title: 'Context-sensitive face', titleLocale: 'en', uiLocale: 'en' });
    database.saveTermDraft(
      {
        termId: created.id,
        title: created.title,
        titleLocale: created.titleLocale,
        definition: 'One concept with intentionally different expressions for real and illustrated contexts.',
        aliases: [],
        localizations: [],
        classificationIds: [classificationId],
        primaryDirectoryClassificationId: classificationId,
        expressions: [
          {
            contextKey: 'portrait.real',
            modelKey: 'gpt-image-2',
            locale: 'en',
            positive: 'natural photographic facial anatomy',
            negative: '',
          },
          {
            contextKey: 'illustration.anime',
            modelKey: 'gpt-image-2',
            locale: 'en',
            positive: 'clean anime facial construction',
            negative: '',
          },
        ],
      },
      'en',
    );

    const approved = database.approveTerm(created.id, 'en');
    expect(resolveTermExpression(approved, 'gpt-image-2', 'en', 'portrait.real')?.positive).toBe(
      'natural photographic facial anatomy',
    );
    expect(resolveTermExpression(approved, 'gpt-image-2', 'en', 'illustration.anime')?.positive).toBe(
      'clean anime facial construction',
    );
    expect(resolveTermExpression(approved, 'gpt-image-2', 'en')).toBeNull();
    expect(
      database.db
        .prepare('SELECT stable_key FROM term_context_profiles WHERE term_id = ? ORDER BY stable_key')
        .all(created.id),
    ).toEqual([{ stable_key: 'illustration.anime' }, { stable_key: 'portrait.real' }]);
    database.close();
  });

  it('keeps multiple classifications independent from the primary directory classification', () => {
    const database = openDatabase();
    const categories = database.getCategories('en').filter((category) => category.selectable !== false);
    const first = categories[0];
    const second = categories.find((category) => category.primaryValueId !== first?.primaryValueId);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const created = database.createTerm({ title: 'Multi-classified term', titleLocale: 'en', uiLocale: 'en' });
    const save = (classificationIds: string[], primaryDirectoryClassificationId: string, definition: string) =>
      database.saveTermDraft(
        {
          termId: created.id,
          title: created.title,
          titleLocale: created.titleLocale,
          definition,
          aliases: [],
          localizations: [],
          classificationIds,
          primaryDirectoryClassificationId,
          expressions: [
            {
              contextKey: 'general.default',
              modelKey: 'gpt-image-2',
              locale: 'en',
              positive: 'multi-classified visual term',
              negative: '',
            },
          ],
        },
        'en',
      );
    const placement = () =>
      database.db
        .prepare('SELECT primary_category_id FROM term_directory_placements WHERE term_id = ?')
        .pluck()
        .get(created.id);

    save([first!.id, second!.id], first!.id, 'Initial classification set.');
    const approved = database.approveTerm(created.id, 'en');
    expect(approved.classificationIds).toEqual([first!.id, second!.id]);
    expect(approved.classifications.map((classification) => classification.id)).toEqual([first!.id, second!.id]);
    expect(placement()).toBe(first!.id);

    database.withdrawTermApproval(created.id, 'en');
    save([first!.id], first!.id, 'Removed only the non-directory classification.');
    const ordinaryClassificationChange = database.approveTerm(created.id, 'en');
    expect(ordinaryClassificationChange.classificationIds).toEqual([first!.id]);
    expect(placement()).toBe(first!.id);
    expect(database.searchTerms('en', '', [second!.primaryValueId]).some((term) => term.id === created.id)).toBe(false);

    database.withdrawTermApproval(created.id, 'en');
    save([first!.id, second!.id], second!.id, 'Changed the explicit primary directory.');
    const moved = database.approveTerm(created.id, 'en');
    expect(moved.primaryDirectoryClassificationId).toBe(second!.id);
    expect(placement()).toBe(second!.id);
    database.close();
  });

  it('filters dictionary pages by an arbitrarily deep classification subtree', () => {
    const database = openDatabase();
    let tree = database.createDictionaryClassification({
      parentId: null,
      name: 'Recursive browse root',
      nameLocale: 'en',
      localizations: [],
      locale: 'en',
    });
    const rootId = tree.nodes.find((node) => node.name === 'Recursive browse root')!.id;
    tree = database.createDictionaryClassification({
      parentId: rootId,
      name: 'Recursive browse child',
      nameLocale: 'en',
      localizations: [],
      locale: 'en',
    });
    const childId = tree.nodes.find((node) => node.name === 'Recursive browse child')!.id;
    tree = database.createDictionaryClassification({
      parentId: childId,
      name: 'Recursive browse grandchild',
      nameLocale: 'en',
      localizations: [],
      locale: 'en',
    });
    const grandchildId = tree.nodes.find((node) => node.name === 'Recursive browse grandchild')!.id;
    const created = database.createTerm({
      title: 'Recursive browse term',
      titleLocale: 'en',
      uiLocale: 'en',
      classificationId: grandchildId,
    });
    expect(created.classificationIds).toEqual([grandchildId]);
    expect(created.classifications.map((classification) => classification.id)).toEqual([grandchildId]);
    expect(created.primaryDirectoryClassificationId).toBe(grandchildId);
    expect(
      database
        .searchTermsPage({
          locale: 'en',
          query: 'Recursive browse term',
          facetValueIds: [],
          classificationIds: [rootId],
          excludeDrafts: false,
          excludeUncited: false,
          includeArchived: false,
          offset: 0,
          limit: 10,
        })
        .items.map((term) => term.id),
    ).toContain(created.id);
    database.saveTermDraft(
      {
        termId: created.id,
        title: created.title,
        titleLocale: created.titleLocale,
        definition: 'Term assigned below the third classification level.',
        aliases: [],
        localizations: [],
        classificationIds: [grandchildId],
        primaryDirectoryClassificationId: grandchildId,
        expressions: [
          {
            modelKey: 'gpt-image-2',
            contextKey: 'general.default',
            locale: 'en',
            positive: 'recursive classification browse term',
            negative: '',
          },
        ],
      },
      'en',
    );
    database.approveTerm(created.id, 'en');

    const page = (classificationId: string) =>
      database.searchTermsPage({
        locale: 'en',
        query: 'Recursive browse term',
        facetValueIds: [],
        classificationIds: [classificationId],
        excludeDrafts: false,
        excludeUncited: false,
        includeArchived: false,
        offset: 0,
        limit: 10,
      });

    expect(page(rootId).items.map((term) => term.id)).toContain(created.id);
    expect(page(childId).items.map((term) => term.id)).toContain(created.id);
    expect(page(grandchildId).items.map((term) => term.id)).toContain(created.id);
    database.close();
  });

  it('maintains the classification tree and migrates approved terms and drafts during a merge', () => {
    const database = openDatabase();
    let tree = database.createDictionaryClassification({
      parentId: null,
      name: 'Source taxonomy',
      nameLocale: 'en',
      localizations: [{ locale: 'ja', name: '移行元分類' }],
      locale: 'en',
    });
    const sourceId = tree.nodes.find((node) => node.name === 'Source taxonomy')!.id;
    tree = database.createDictionaryClassification({
      parentId: null,
      name: 'Target taxonomy',
      nameLocale: 'en',
      localizations: [{ locale: 'fr', name: 'Classification cible' }],
      locale: 'en',
    });
    const targetId = tree.nodes.find((node) => node.name === 'Target taxonomy')!.id;
    tree = database.createDictionaryClassification({
      parentId: sourceId,
      name: 'Movable child',
      nameLocale: 'en',
      localizations: [],
      locale: 'en',
    });
    const childId = tree.nodes.find((node) => node.name === 'Movable child')!.id;
    tree = database.updateDictionaryClassification({
      id: childId,
      name: 'Moved child',
      nameLocale: 'en',
      localizations: [{ locale: 'de', name: 'Verschobene Kategorie' }],
      locale: 'en',
    });
    expect(tree.nodes.find((node) => node.id === childId)?.localizations).toEqual([
      { locale: 'de', name: 'Verschobene Kategorie' },
    ]);
    expect(
      database.previewDictionaryClassificationMove({ id: childId, parentId: targetId, locale: 'en' }),
    ).toMatchObject({
      classificationId: childId,
      targetParentId: targetId,
      childClassificationCount: 0,
      termCount: 0,
    });
    tree = database.moveDictionaryClassification({ id: childId, parentId: targetId, locale: 'en' });
    expect(tree.nodes.find((node) => node.id === childId)).toMatchObject({
      parentId: targetId,
      path: 'Target taxonomy / Moved child',
    });
    tree = database.createDictionaryClassification({
      parentId: targetId,
      name: 'Second child',
      nameLocale: 'en',
      localizations: [],
      locale: 'en',
    });
    const secondChildId = tree.nodes.find((node) => node.name === 'Second child')!.id;
    tree = database.reorderDictionaryClassifications({
      parentId: targetId,
      orderedIds: [secondChildId, childId],
      locale: 'en',
    });
    expect(
      tree.nodes
        .filter((node) => node.parentId === targetId)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((node) => node.id),
    ).toEqual([secondChildId, childId]);
    tree = database.setDictionaryClassificationState({ id: childId, state: 'DISABLED', locale: 'en' });
    expect(tree.nodes.find((node) => node.id === childId)?.state).toBe('DISABLED');
    database.setDictionaryClassificationState({ id: childId, state: 'ACTIVE', locale: 'en' });

    const approvedSeed = database.createTerm({ title: 'Classification merge term', titleLocale: 'en', uiLocale: 'en' });
    database.saveTermDraft(
      {
        termId: approvedSeed.id,
        title: approvedSeed.title,
        titleLocale: approvedSeed.titleLocale,
        definition: 'An approved term moved by classification merge.',
        aliases: [],
        localizations: [],
        classificationIds: [sourceId],
        primaryDirectoryClassificationId: sourceId,
        expressions: [
          {
            contextKey: 'portrait.real',
            modelKey: 'gpt-image-2',
            locale: 'en',
            positive: 'classification merge expression',
            negative: '',
          },
        ],
      },
      'en',
    );
    const approvedBeforeMerge = database.approveTerm(approvedSeed.id, 'en');
    const draftSeed = database.createTerm({ title: 'Classification merge draft', titleLocale: 'en', uiLocale: 'en' });
    database.saveTermDraft(
      {
        termId: draftSeed.id,
        title: draftSeed.title,
        titleLocale: draftSeed.titleLocale,
        definition: '',
        aliases: [],
        localizations: [],
        classificationIds: [sourceId],
        primaryDirectoryClassificationId: sourceId,
        expressions: [],
      },
      'en',
    );

    expect(database.previewDictionaryClassificationMerge({ sourceId, targetId, locale: 'en' })).toMatchObject({
      sourceId,
      targetId,
      directTermCount: 1,
      childClassificationCount: 0,
    });
    tree = database.mergeDictionaryClassification({ sourceId, targetId, locale: 'en' });
    expect(tree.nodes.find((node) => node.id === sourceId)?.state).toBe('DISABLED');
    const approvedAfterMerge = database.getTerm(approvedSeed.id, 'en');
    expect(approvedAfterMerge.revisionNo).toBe(approvedBeforeMerge.revisionNo + 1);
    expect(approvedAfterMerge.classificationIds).toEqual([targetId]);
    expect(approvedAfterMerge.primaryDirectoryClassificationId).toBe(targetId);
    expect(resolveTermExpression(approvedAfterMerge, 'gpt-image-2', 'en', 'portrait.real')?.positive).toBe(
      'classification merge expression',
    );
    const draftPayload = JSON.parse(
      database.db
        .prepare("SELECT payload FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?")
        .pluck()
        .get(draftSeed.id) as string,
    );
    expect(draftPayload).toMatchObject({
      classificationIds: [targetId],
      primaryDirectoryClassificationId: targetId,
    });
    database.close();
  });

  it('withdraws approval and soft-deletes and restores a term without losing its revision', () => {
    const database = openDatabase();
    const created = database.createTerm({
      title: '可逆状态测试',
      titleLocale: 'zh',
      uiLocale: 'zh',
    });
    const classificationId = database.getCategories('zh')[0]!.id;
    database.saveTermDraft(
      {
        termId: created.id,
        title: created.title,
        titleLocale: created.titleLocale,
        definition: '用于测试可逆状态。',
        aliases: [],
        localizations: [],
        classificationIds: [classificationId],
        primaryDirectoryClassificationId: classificationId,
        expressions: [
          {
            contextKey: 'general.default',
            modelKey: 'gpt-image-2',
            locale: 'zh',
            positive: '可逆状态测试',
            negative: '',
          },
        ],
      },
      'zh',
    );
    const approved = database.approveTerm(created.id, 'zh');
    const revisionNo = approved.revisionNo;

    const withdrawn = database.withdrawTermApproval(created.id, 'zh');
    expect(withdrawn).toMatchObject({ editorialState: 'DRAFT', hasDraft: true, revisionNo });
    expect(
      database
        .searchTerms('zh', '', [], { excludeDrafts: true, excludeUncited: false })
        .some((term) => term.id === created.id),
    ).toBe(false);

    const archived = database.setTermArchived(created.id, true, 'zh');
    expect(archived.editorialState).toBe('ARCHIVED');
    expect(database.searchTerms('zh').some((term) => term.id === created.id)).toBe(false);
    expect(
      database
        .searchTerms('zh', '', [], { excludeDrafts: false, excludeUncited: false, includeArchived: true })
        .find((term) => term.id === created.id)?.editorialState,
    ).toBe('ARCHIVED');

    const restored = database.setTermArchived(created.id, false, 'zh');
    expect(restored).toMatchObject({ editorialState: 'DRAFT', hasDraft: true, revisionNo });
    expect(database.searchTerms('zh').some((term) => term.id === created.id)).toBe(true);
    expect(
      database.db
        .prepare('SELECT operation FROM change_events WHERE entity_id = ? ORDER BY occurred_at')
        .all(created.id),
    ).toEqual(
      expect.arrayContaining([{ operation: 'WITHDRAW_APPROVAL' }, { operation: 'ARCHIVE' }, { operation: 'RESTORE' }]),
    );
    database.close();
  }, 15_000);

  it('keeps a later zero-citation term when the external dictionary is reconciled again', () => {
    const database = openDatabase();
    const created = database.createTerm({
      title: '未来新增衣物词',
      titleLocale: 'zh',
      uiLocale: 'zh',
    });
    database.db.prepare("DELETE FROM app_meta WHERE key = 'dictionary_core_revision'").run();
    database.close();

    const root = roots.at(-1)!;
    const reopened = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
    databases.push(reopened);
    reopened.initialize();
    importSyntheticLibrary(reopened);
    expect(reopened.searchTerms('zh').some((term) => term.id === created.id)).toBe(true);
    expect(reopened.getTerm(created.id, 'zh').metrics.citationCount).toBe(0);
    reopened.close();
  }, 15_000);

  it('uses a confirmed word selection as an exact dictionary filter', () => {
    const database = openDatabase();
    const selected = database
      .searchTerms('zh')
      .slice(0, 3)
      .map((term) => term.id);
    const filtered = database.searchTerms('zh', '', [], {
      excludeDrafts: false,
      excludeUncited: false,
      termIds: selected,
    });
    expect(filtered.map((term) => term.id).sort()).toEqual([...selected].sort());
    database.close();
  }, 15_000);

  it('stores reusable parameterized word palettes and prompt references', () => {
    const database = openDatabase();
    const termIds = ['term_young_adult', 'term_relaxed_neck'];
    const palette = database.createWordPalette({
      locale: 'zh',
      name: '身材基础盘',
      nameLocale: 'zh',
      description: '',
      localizations: [],
      referenceAssetIds: ['ref_003', 'img_011'],
      parameters: [
        {
          stableKey: 'cup_size',
          name: '罩杯',
          nameLocale: 'zh',
          localizations: [],
          required: true,
          options: ['A', 'B', 'C', 'D'].map((value) => ({
            value,
            label: value,
            labelLocale: 'zh',
            localizations: [],
            contents: [{ kind: 'TEXT', promptFragment: `${value} cup`, negativeFragment: '' }],
          })),
        },
      ],
      promptNodes: [
        { kind: 'TERM', termId: termIds[0] },
        { kind: 'TEXT', promptFragment: ', ', negativeFragment: '' },
        { kind: 'TERM', termId: termIds[1] },
        { kind: 'TEXT', promptFragment: ', ', negativeFragment: '' },
        { kind: 'SLOT', stableKey: 'cup_size' },
      ],
    });
    expect(palette.kind).toBe('PARAMETERIZED');
    expect(palette).toMatchObject({ revisionNo: 1, revisionId: expect.any(String) });
    expect(palette.revisions).toHaveLength(1);
    expect(palette.terms.map((term) => term.id)).toEqual(termIds);
    expect(palette.parameters[0].options).toHaveLength(4);
    expect(palette.referenceAssets.map((asset) => asset.id)).toEqual(['ref_003', 'img_011']);

    const generation = database.prepareGeneration({
      seriesId: null,
      title: '参数化调词盘',
      manualPrompt: 'adult portrait',
      prompt: 'adult portrait, C cup',
      changeSummary: '',
      referenceAssetIds: [],
      termIds,
      wordPaletteReferences: [
        {
          paletteId: palette.id,
          paletteRevisionId: palette.revisionId,
          parameterValues: { cup_size: 'C' },
          promptLocale: 'en',
        },
      ],
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'medium',
    });
    const binding = database.db
      .prepare(
        `SELECT palette_id paletteId, palette_revision_id paletteRevisionId,
      parameter_values_json valuesJson, prompt_locale promptLocale
      FROM prompt_palette_bindings WHERE prompt_version_id = ?`,
      )
      .get(generation.versionId) as {
      paletteId: string;
      paletteRevisionId: string;
      valuesJson: string;
      promptLocale: string;
    };
    expect(binding.paletteId).toBe(palette.id);
    expect(binding.paletteRevisionId).toBe(palette.revisionId);
    expect(JSON.parse(binding.valuesJson)).toEqual({ cup_size: 'C' });
    expect(binding).toMatchObject({ promptLocale: 'en' });
    expect(generation.effectiveReferenceAssetIds).toEqual(['ref_003', 'img_011']);
    expect(
      database.db
        .prepare(
          `SELECT source_type sourceType, count(*) count FROM reference_bindings
      WHERE prompt_version_id = ? GROUP BY source_type`,
        )
        .all(generation.versionId),
    ).toEqual([{ sourceType: 'WORD_PALETTE', count: 2 }]);
    expect(database.getWordPalettes('zh').find((item) => item.id === palette.id)?.usageCount).toBe(1);

    const revised = database.updateWordPalette({
      paletteId: palette.id,
      locale: 'zh',
      name: '身材基础盘二版',
      nameLocale: 'zh',
      description: '调整名称',
      localizations: [],
      referenceAssetIds: [],
      parameters: [
        {
          stableKey: 'cup_size',
          name: '罩杯',
          nameLocale: 'zh',
          localizations: [],
          required: true,
          options: ['A', 'B', 'C', 'D'].map((value) => ({
            value,
            label: value,
            labelLocale: 'zh',
            localizations: [],
            contents: [{ kind: 'TEXT', promptFragment: `${value} cup`, negativeFragment: '' }],
          })),
        },
      ],
      promptNodes: [
        { kind: 'TERM', termId: termIds[0] },
        { kind: 'TEXT', promptFragment: ', ', negativeFragment: '' },
        { kind: 'TERM', termId: termIds[1] },
        { kind: 'TEXT', promptFragment: ', ', negativeFragment: '' },
        { kind: 'SLOT', stableKey: 'cup_size' },
      ],
    });
    expect(revised.revisionNo).toBe(2);
    expect(revised.revisions.map((revision) => revision.revisionNo)).toEqual([2, 1]);
    expect(revised.revisions.find((revision) => revision.id === palette.revisionId)?.name).toBe('身材基础盘');
    expect(
      revised.revisions
        .find((revision) => revision.id === palette.revisionId)
        ?.referenceAssets.map((asset) => asset.id),
    ).toEqual(['ref_003', 'img_011']);
    const storedReference = database.getWorkbench('zh').series.find((series) => series.id === generation.seriesId)
      ?.versions[0].wordPaletteReferences[0];
    expect(storedReference?.paletteRevisionId).toBe(palette.revisionId);
    expect(
      database.getWorkbench('zh').series.find((series) => series.id === generation.seriesId)?.versions[0]
        .referenceAssets,
    ).toEqual([]);
    database.close();
  });

  it('persists arbitrary palette, parameter, and option localizations without locale-specific columns', () => {
    const database = openDatabase();
    const palette = database.createWordPalette({
      locale: 'zh',
      name: '人像细节',
      nameLocale: 'zh-Hans',
      description: '控制人像细节',
      localizations: [
        { locale: 'en', name: 'Portrait detail', description: 'Controls portrait detail' },
        { locale: 'ja', name: 'ポートレートの詳細', description: 'ポートレートの詳細を制御' },
        { locale: 'fr', name: 'Détail du portrait', description: 'Contrôle le détail du portrait' },
      ],
      referenceAssetIds: [],
      parameters: [
        {
          stableKey: 'finish',
          name: '质感',
          nameLocale: 'zh-Hans',
          localizations: [
            { locale: 'en', name: 'Finish' },
            { locale: 'ja', name: '仕上げ' },
            { locale: 'fr', name: 'Finition' },
          ],
          required: true,
          options: [
            {
              value: 'natural',
              label: '自然',
              labelLocale: 'zh-Hans',
              localizations: [
                { locale: 'en', label: 'Natural' },
                { locale: 'ja', label: '自然' },
                { locale: 'fr', label: 'Naturel' },
              ],
              contents: [{ kind: 'TEXT', promptFragment: 'natural finish', negativeFragment: '' }],
            },
          ],
        },
      ],
      promptNodes: [{ kind: 'SLOT', stableKey: 'finish' }],
    });

    expect(palette).toMatchObject({
      name: '人像细节',
      nameLocale: 'zh-hans',
      localizations: [
        { locale: 'en', name: 'Portrait detail' },
        { locale: 'fr', name: 'Détail du portrait' },
        { locale: 'ja', name: 'ポートレートの詳細' },
      ],
      parameters: [
        {
          name: '质感',
          nameLocale: 'zh-hans',
          localizations: [
            { locale: 'en', name: 'Finish' },
            { locale: 'fr', name: 'Finition' },
            { locale: 'ja', name: '仕上げ' },
          ],
          options: [
            {
              label: '自然',
              labelLocale: 'zh-hans',
              localizations: [
                { locale: 'en', label: 'Natural' },
                { locale: 'fr', label: 'Naturel' },
                { locale: 'ja', label: '自然' },
              ],
            },
          ],
        },
      ],
    });
    expect(
      database.db
        .prepare(
          `SELECT locale FROM word_palette_revision_localizations
          WHERE palette_revision_id = ? ORDER BY locale`,
        )
        .all(palette.revisionId),
    ).toEqual([{ locale: 'en' }, { locale: 'fr' }, { locale: 'ja' }]);
    expect(
      database.db
        .prepare("SELECT name FROM pragma_table_info('word_palette_revisions') WHERE name IN ('name_zh', 'name_en')")
        .all(),
    ).toEqual([]);
    database.close();
  });

  it('updates, archives, restores, and soft-deletes word palettes', () => {
    const database = openDatabase();
    const created = database.createWordPalette({
      locale: 'zh',
      name: '待维护调词盘',
      nameLocale: 'zh',
      description: '',
      localizations: [{ locale: 'en', name: 'Palette to maintain', description: '' }],
      referenceAssetIds: [],
      parameters: [],
      promptNodes: [{ kind: 'TERM', termId: 'term_young_adult' }],
    });
    expect(created.revisionNo).toBe(1);
    const updated = database.updateWordPalette({
      paletteId: created.id,
      locale: 'zh',
      name: '已编辑调词盘',
      nameLocale: 'zh',
      description: '用于状态测试',
      localizations: [{ locale: 'en', name: 'Edited palette', description: '' }],
      referenceAssetIds: [],
      parameters: [
        {
          stableKey: 'finish',
          name: '质感',
          nameLocale: 'zh',
          localizations: [{ locale: 'en', name: 'Finish' }],
          required: false,
          options: [
            {
              value: 'natural',
              label: '自然',
              labelLocale: 'zh',
              localizations: [{ locale: 'en', label: 'Natural' }],
              contents: [{ kind: 'TEXT', promptFragment: 'natural finish', negativeFragment: '' }],
            },
          ],
        },
      ],
      promptNodes: [
        { kind: 'TERM', termId: 'term_young_adult' },
        { kind: 'TEXT', promptFragment: ', ', negativeFragment: '' },
        { kind: 'TERM', termId: 'term_relaxed_neck' },
        { kind: 'TEXT', promptFragment: ', ', negativeFragment: '' },
        { kind: 'SLOT', stableKey: 'finish' },
      ],
    });
    expect(updated).toMatchObject({ name: '已编辑调词盘', description: '用于状态测试', status: 'ACTIVE' });
    expect(updated.revisionNo).toBe(2);
    expect(updated.revisions).toHaveLength(2);
    expect(updated.terms.map((term) => term.id)).toEqual(['term_young_adult', 'term_relaxed_neck']);
    expect(updated.parameters[0]).toMatchObject({
      name: '质感',
      nameLocale: 'zh',
      localizations: [{ locale: 'en', name: 'Finish' }],
    });

    database.setWordPaletteArchived(created.id, true);
    expect(database.getWordPalettes('zh').find((palette) => palette.id === created.id)?.status).toBe('ARCHIVED');
    expect(() =>
      database.prepareGeneration({
        seriesId: null,
        title: '',
        manualPrompt: 'portrait',
        prompt: 'portrait',
        changeSummary: '',
        referenceAssetIds: [],
        termIds: [],
        wordPaletteReferences: [
          { paletteId: created.id, paletteRevisionId: created.revisionId, parameterValues: {}, promptLocale: 'en' },
        ],
        modelKey: 'gpt-image-2',
        canvasPresetKey: 'portrait_2_3',
        width: 1024,
        height: 1536,
        quality: 'low',
      }),
    ).toThrow('Word palette not found');

    database.setWordPaletteArchived(created.id, false);
    expect(database.getWordPalettes('zh').find((palette) => palette.id === created.id)?.status).toBe('ACTIVE');
    database.deleteWordPalette(created.id);
    expect(database.getWordPalettes('zh').some((palette) => palette.id === created.id)).toBe(false);
    expect(
      database.db.prepare('SELECT deleted_at deletedAt FROM word_palettes WHERE id = ?').get(created.id),
    ).toMatchObject({ deletedAt: expect.any(String) });
    expect(
      database.db
        .prepare(
          `SELECT count(*) count FROM tombstones
      WHERE entity_type = 'WORD_PALETTE' AND entity_id = ?`,
        )
        .get(created.id),
    ).toEqual({ count: 1 });
    expect(
      (
        database.db
          .prepare(
            `SELECT operation FROM change_events
      WHERE entity_type = 'WORD_PALETTE' AND entity_id = ? ORDER BY occurred_at`,
          )
          .all(created.id) as Array<{ operation: string }>
      ).map((event) => event.operation),
    ).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'ARCHIVE', 'UNARCHIVE', 'DELETE']));
    database.close();
  });

  it('reconciles built-in palettes without replacing a user palette', () => {
    const database = openDatabase();
    const custom = database.createWordPalette({
      locale: 'zh',
      name: '我的调词盘',
      nameLocale: 'zh',
      description: '',
      localizations: [],
      referenceAssetIds: [],
      parameters: [],
      promptNodes: [{ kind: 'TERM', termId: 'term_young_adult' }],
    });
    database.db.prepare("DELETE FROM app_meta WHERE key = 'word_palette_catalog_revision'").run();
    database.close();

    const root = roots.at(-1)!;
    const reopened = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
    databases.push(reopened);
    reopened.initialize();
    importSyntheticLibrary(reopened);
    const palettes = reopened.getWordPalettes('zh');
    expect(palettes.filter((palette) => palette.id.startsWith('palette_catalog_'))).toHaveLength(1);
    expect(palettes.find((palette) => palette.id === custom.id)?.name).toBe('我的调词盘');
    reopened.close();
  });

  it('creates a titled prompt series and then stacks a new prompt version', () => {
    const database = openDatabase();
    const first = database.prepareGeneration({
      seriesId: null,
      title: '雨后车站',
      manualPrompt: 'young adult woman at a station after rain',
      prompt: 'young adult woman at a station after rain',
      changeSummary: '',
      referenceAssetIds: [],
      termIds: [],
      wordPaletteReferences: [],
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'medium',
    });
    const second = database.prepareGeneration({
      seriesId: first.seriesId,
      title: '',
      manualPrompt: 'young adult woman at a station after rain, medium shot',
      prompt: 'young adult woman at a station after rain, medium shot',
      changeSummary: '改为中景',
      referenceAssetIds: [],
      termIds: [],
      wordPaletteReferences: [],
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'medium',
    });
    const series = database.getWorkbench().series.find((item) => item.id === first.seriesId);
    expect(series?.title).toBe('雨后车站');
    expect(series?.versions).toHaveLength(2);
    expect(series?.currentVersionId).toBe(second.versionId);
    expect(series?.versions[0].changeSummary).toBe('改为中景');
    expect(series?.versions[0].parentVersionId).toBe(first.versionId);
    database.close();
  });

  it('restores structured creation inputs and keeps one renamed series title across locales', () => {
    const database = openDatabase();
    const palette = database.createWordPalette({
      locale: 'zh',
      name: '结构化测试盘',
      nameLocale: 'zh',
      description: '',
      localizations: [{ locale: 'en', name: 'Structured test palette', description: '' }],
      referenceAssetIds: [],
      parameters: [],
      promptNodes: [{ kind: 'TERM', termId: 'term_relaxed_neck' }],
    });
    const created = database.prepareGeneration({
      seriesId: null,
      title: '窗边肖像',
      manualPrompt: 'soft window portrait',
      prompt: 'soft window portrait, 年轻成年特征, 放松肩颈线',
      changeSummary: '',
      referenceAssetIds: ['ref_003'],
      termPromptLocale: 'zh',
      termIds: ['term_young_adult'],
      wordPaletteReferences: [
        { paletteId: palette.id, paletteRevisionId: palette.revisionId, parameterValues: {}, promptLocale: 'zh' },
      ],
      modelKey: 'gpt-image-2',
      canvasPresetKey: 'portrait_2_3',
      width: 1024,
      height: 1536,
      quality: 'low',
    });

    const version = database.getWorkbench('zh').series.find((item) => item.id === created.seriesId)?.versions[0];
    expect(version).toMatchObject({
      manualPrompt: 'soft window portrait',
      isStructured: true,
      termPromptLocale: 'zh',
      termIds: ['term_young_adult'],
      wordPaletteReferences: [
        { paletteId: palette.id, paletteRevisionId: palette.revisionId, parameterValues: {}, promptLocale: 'zh' },
      ],
    });
    expect(version?.referenceAssets.map((asset) => asset.id)).toEqual(['ref_003']);
    expect(version?.runs[0].quality).toBe('low');

    database.renamePromptSeries({ seriesId: created.seriesId, title: '雨窗肖像' });
    expect(database.getWorkbench('zh').series.find((item) => item.id === created.seriesId)?.title).toBe('雨窗肖像');
    expect(database.getWorkbench('en').series.find((item) => item.id === created.seriesId)?.title).toBe('雨窗肖像');
    expect(
      database.db
        .prepare(
          `SELECT operation FROM change_events
      WHERE entity_type = 'PROMPT_SERIES' AND entity_id = ? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(created.seriesId),
    ).toEqual({ operation: 'RENAME' });

    const staleAutoRename = database.renamePromptSeries({
      seriesId: created.seriesId,
      title: '迟到的自动标题',
      expectedTitle: '窗边肖像',
    });
    expect(staleAutoRename.renamed).toBe(false);
    expect(database.getWorkbench('zh').series.find((item) => item.id === created.seriesId)?.title).toBe('雨窗肖像');
    database.close();
  });

  it('keeps annotation resolution and dismissal recoverable in local history', () => {
    const database = openDatabase();
    const created = database.addAnnotation({
      imageAssetId: 'img_018',
      type: 'RECTANGLE',
      x: 0.42,
      y: 0.33,
      width: 0.1,
      height: 0.1,
      comment: '测试缺陷',
    });
    const rowCount = database.db.prepare('SELECT count(*) count FROM annotations WHERE id = ?').get(created.id);

    expect(database.setAnnotationStatus({ annotationId: created.id, status: 'DISMISSED' }).status).toBe('DISMISSED');
    expect(database.setAnnotationStatus({ annotationId: created.id, status: 'OPEN' }).status).toBe('OPEN');
    expect(database.setAnnotationStatus({ annotationId: created.id, status: 'RESOLVED' }).status).toBe('RESOLVED');
    expect(database.db.prepare('SELECT count(*) count FROM annotations WHERE id = ?').get(created.id)).toEqual(
      rowCount,
    );
    expect(
      database.db
        .prepare(
          "SELECT operation, payload_json payload FROM change_events WHERE entity_type = 'ANNOTATION' AND entity_id = ? ORDER BY rowid",
        )
        .all(created.id),
    ).toEqual([
      expect.objectContaining({ operation: 'CREATE' }),
      expect.objectContaining({ operation: 'SET_STATUS', payload: expect.stringContaining('DISMISSED') }),
      expect.objectContaining({ operation: 'SET_STATUS', payload: expect.stringContaining('OPEN') }),
      expect.objectContaining({ operation: 'SET_STATUS', payload: expect.stringContaining('RESOLVED') }),
    ]);
    database.close();

    const root = roots.at(-1)!;
    const reopened = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
    databases.push(reopened);
    reopened.initialize();
    expect(reopened.listAnnotations('img_018').find((annotation) => annotation.id === created.id)?.status).toBe(
      'RESOLVED',
    );
    reopened.close();
  });

  it('stores independent aesthetic and realism ratings with recoverable history', () => {
    const database = openDatabase();
    expect(database.listImageRatings()).toEqual([]);

    const created = database.setImageRating('img_018', 'AESTHETIC', 4);
    const realism = database.setImageRating('img_018', 'REALISM', 3);
    expect(created).toMatchObject({ imageAssetId: 'img_018', dimension: 'AESTHETIC', score: 4 });
    expect(realism).toMatchObject({ imageAssetId: 'img_018', dimension: 'REALISM', score: 3 });
    expect(database.listImageRatings()).toHaveLength(2);

    const changed = database.setImageRating('img_018', 'AESTHETIC', 2);
    expect(changed).toMatchObject({ id: created?.id, imageAssetId: 'img_018', dimension: 'AESTHETIC', score: 2 });

    expect(database.setImageRating('img_018', 'AESTHETIC', null)).toBeNull();
    expect(database.listImageRatings()).toEqual([realism]);
    expect(
      database.db
        .prepare(
          `SELECT count(*) count FROM tombstones
      WHERE entity_type = 'IMAGE_RATING' AND entity_id = ?`,
        )
        .get(created?.id),
    ).toEqual({ count: 1 });

    const restored = database.setImageRating('img_018', 'AESTHETIC', 5);
    expect(restored).toMatchObject({ id: created?.id, imageAssetId: 'img_018', dimension: 'AESTHETIC', score: 5 });
    expect(
      (
        database.db
          .prepare(
            `SELECT operation FROM change_events
      WHERE entity_type = 'IMAGE_RATING' AND entity_id = ? ORDER BY rowid`,
          )
          .all(created?.id) as Array<{ operation: string }>
      ).map((event) => event.operation),
    ).toEqual(['CREATE', 'SET_SCORE', 'DELETE', 'RESTORE']);
    database.close();
  });

  it('pages a deduplicated material gallery across every source type', () => {
    const database = openDatabase();
    const creation = database.listGallery({
      locale: 'zh',
      source: 'CREATION',
      unratedDimensions: [],
      cursor: null,
      limit: 5,
    });
    const dictionary = database.listGallery({
      locale: 'zh',
      source: 'DICTIONARY',
      unratedDimensions: [],
      cursor: null,
      limit: 5,
    });
    const allFirstPage = database.listGallery({
      locale: 'zh',
      source: 'ALL',
      unratedDimensions: [],
      cursor: null,
      limit: 5,
    });
    const activeAssetCount = Number(
      (
        database.db
          .prepare(
            `SELECT count(*) count FROM image_assets
      WHERE deleted_at IS NULL`,
          )
          .get() as { count: number }
      ).count,
    );

    expect(creation.total).toBeGreaterThan(0);
    expect(creation.items).toHaveLength(5);
    expect(creation.items.every((item) => item.creation)).toBe(true);
    expect(dictionary.total).toBeGreaterThan(0);
    expect(dictionary.items).toHaveLength(Math.min(5, dictionary.total));
    expect(dictionary.items.every((item) => item.dictionary)).toBe(true);
    expect(allFirstPage.total).toBe(activeAssetCount);
    expect(allFirstPage.total).toBeGreaterThanOrEqual(creation.total);
    expect(allFirstPage.total).toBeGreaterThanOrEqual(dictionary.total);

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = database.listGallery({ locale: 'zh', source: 'ALL', unratedDimensions: [], cursor, limit: 60 });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(allFirstPage.total);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() =>
      database.listGallery({ locale: 'zh', source: 'ALL', unratedDimensions: [], cursor: 'not-a-cursor', limit: 5 }),
    ).toThrow('Invalid gallery cursor');
    database.close();
  });

  it('searches gallery series, dictionary, origin, and MIME metadata case-insensitively', () => {
    const database = openDatabase();
    const creationTarget = database.listGallery({
      locale: 'zh',
      source: 'CREATION',
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    }).items[0];
    const dictionaryTarget = database.listGallery({
      locale: 'zh',
      source: 'DICTIONARY',
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    }).items[0];
    expect(creationTarget?.creation).toBeDefined();
    expect(dictionaryTarget?.dictionary).toBeDefined();

    database.db
      .prepare(`UPDATE prompt_series SET title = ?, title_zh = ?, title_en = ? WHERE id = ?`)
      .run(
        'Prismatic Search Series',
        'Prismatic Search Series',
        'Prismatic Search Series',
        creationTarget.creation!.seriesId,
      );
    database.db
      .prepare(
        `UPDATE term_revisions SET title = ?, title_locale = 'en'
      WHERE id = (SELECT current_revision_id FROM terms WHERE id = ?)`,
      )
      .run('Dictionary Needle Theta', dictionaryTarget.dictionary!.termId);
    database.db
      .prepare(`UPDATE image_assets SET origin_type = ?, mime_type = ? WHERE id = ?`)
      .run('LOCAL_SEARCH_ORIGIN', 'image/x-gallery-search', creationTarget.asset.id);

    const searches = [
      { query: 'pRiSmAtIc SeArCh SeRiEs', source: 'CREATION' as const, assetId: creationTarget.asset.id },
      { query: 'dIcTiOnArY nEeDlE tHeTa', source: 'DICTIONARY' as const, assetId: dictionaryTarget.asset.id },
      { query: 'local_search_origin', source: 'ALL' as const, assetId: creationTarget.asset.id },
      { query: 'IMAGE/X-GALLERY-SEARCH', source: 'ALL' as const, assetId: creationTarget.asset.id },
    ];
    for (const search of searches) {
      const result = database.listGallery({
        locale: 'zh',
        source: search.source,
        query: search.query,
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      });
      expect(result.total).toBeGreaterThan(0);
      expect(result.items.map((item) => item.asset.id)).toContain(search.assetId);
    }
    database.close();
  });

  it('applies gallery search and asset-kind filters before pagination and total counts', () => {
    const database = openDatabase();
    const pageKind = (assetKind: 'GENERATED' | 'REFERENCE') => {
      const ids: string[] = [];
      let cursor: string | null = null;
      let expectedTotal: number | null = null;
      do {
        const page = database.listGallery({
          locale: 'zh',
          source: 'ALL',
          query: 'IMAGE/',
          assetKinds: [assetKind],
          unratedDimensions: [],
          cursor,
          limit: 3,
        });
        expectedTotal ??= page.total;
        expect(page.total).toBe(expectedTotal);
        expect(page.items.every((item) => item.asset.kind === assetKind)).toBe(true);
        expect(page.items.every((item) => item.asset.mimeType.toLowerCase().includes('image/'))).toBe(true);
        ids.push(...page.items.map((item) => item.asset.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(expectedTotal ?? 0);
      expect(new Set(ids).size).toBe(ids.length);
      return expectedTotal ?? 0;
    };

    const generatedTotal = pageKind('GENERATED');
    const referenceTotal = pageKind('REFERENCE');
    const combined = database.listGallery({
      locale: 'zh',
      source: 'ALL',
      query: 'image/',
      assetKinds: ['GENERATED', 'REFERENCE'],
      unratedDimensions: [],
      cursor: null,
      limit: 3,
    });
    expect(generatedTotal).toBeGreaterThan(0);
    expect(referenceTotal).toBeGreaterThan(0);
    expect(combined.total).toBe(generatedTotal + referenceTotal);
    database.close();
  });

  it('returns persisted ratings with dictionary gallery images after reopening', () => {
    const database = openDatabase();
    const dictionary = database.listGallery({
      locale: 'zh',
      source: 'DICTIONARY',
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    });
    const dictionaryMaterial = dictionary.items[0];
    expect(dictionaryMaterial).toBeDefined();
    expect(database.setImageRating(dictionaryMaterial!.asset.id, 'AESTHETIC', 5)).toMatchObject({
      imageAssetId: dictionaryMaterial!.asset.id,
      dimension: 'AESTHETIC',
      score: 5,
    });
    database.close();

    const root = roots.at(-1)!;
    const reopened = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
    databases.push(reopened);
    reopened.initialize();
    const reloaded = reopened.listGallery({
      locale: 'zh',
      source: 'DICTIONARY',
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    });
    expect(reloaded.items.find((item) => item.id === dictionaryMaterial!.id)?.ratings.aesthetic?.score).toBe(5);
    expect(reloaded.items.find((item) => item.id === dictionaryMaterial!.id)?.ratings.realism).toBeNull();
    reopened.close();
  }, 15_000);

  it('filters selected unrated dimensions by union before applying gallery pagination', () => {
    const database = openDatabase();
    const bothDimensions = ['AESTHETIC', 'REALISM'] as const;
    const before = database.listGallery({
      locale: 'zh',
      source: 'CREATION',
      unratedDimensions: [...bothDimensions],
      cursor: null,
      limit: 5,
    });
    const ratedId = before.items[0].asset.id;

    database.setImageRating(ratedId, 'AESTHETIC', 4);
    const afterAesthetic = database.listGallery({
      locale: 'zh',
      source: 'CREATION',
      unratedDimensions: [...bothDimensions],
      cursor: null,
      limit: 5,
    });
    expect(afterAesthetic.total).toBe(before.total);
    expect(afterAesthetic.items.map((item) => item.asset.id)).toContain(ratedId);
    expect(
      database
        .listGallery({
          locale: 'zh',
          source: 'CREATION',
          unratedDimensions: ['AESTHETIC'],
          cursor: null,
          limit: 5,
        })
        .items.map((item) => item.asset.id),
    ).not.toContain(ratedId);
    expect(
      database
        .listGallery({
          locale: 'zh',
          source: 'CREATION',
          unratedDimensions: ['REALISM'],
          cursor: null,
          limit: 5,
        })
        .items.map((item) => item.asset.id),
    ).toContain(ratedId);

    database.setImageRating(ratedId, 'REALISM', 3);
    const after = database.listGallery({
      locale: 'zh',
      source: 'CREATION',
      unratedDimensions: [...bothDimensions],
      cursor: null,
      limit: 5,
    });
    const normal = database.listGallery({
      locale: 'zh',
      source: 'CREATION',
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    });

    expect(after.total).toBe(before.total - 1);
    expect(after.items.map((item) => item.asset.id)).not.toContain(ratedId);
    expect(normal.items.find((item) => item.asset.id === ratedId)?.ratings).toMatchObject({
      aesthetic: { dimension: 'AESTHETIC', score: 4 },
      realism: { dimension: 'REALISM', score: 3 },
    });

    database.setImageRating(ratedId, 'REALISM', null);
    expect(
      database.listGallery({
        locale: 'zh',
        source: 'CREATION',
        unratedDimensions: [...bothDimensions],
        cursor: null,
        limit: 5,
      }).total,
    ).toBe(before.total);
    database.close();
  });
});
