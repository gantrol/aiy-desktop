import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../src/main/database';
import type { RegisterPackReleaseInput } from '../src/main/database/pack-repository';

const roots: string[] = [];

function openDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-pack-storage-'));
  roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  database.initialize();
  return database;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function registerPack(database: LibraryDatabase, id: string) {
  return database.registerPack({
    id,
    kind: 'CONTENT',
    displayName: id,
    contentKinds: ['KNOWLEDGE'],
  });
}

function releaseInput(
  packId: string,
  version: string,
  options: Partial<RegisterPackReleaseInput> = {},
): RegisterPackReleaseInput {
  const suffix = `${packId}-${version}`;
  return {
    id: `release-${suffix}`,
    packId,
    version,
    manifestVersion: 1,
    contentHash: `sha256:${suffix}`,
    manifest: { packId, version },
    items: [
      {
        id: `item-${suffix}`,
        itemKey: `knowledge.${suffix}`,
        objectType: 'TERM_REVISION',
        objectRevisionId: `term-revision-${suffix}`,
        contentHash: `sha256:item-${suffix}`,
      },
    ],
    ...options,
  };
}

describe('local-space and pack storage', () => {
  it('uses one stable baseline local space and aligns it with the registry identity', () => {
    const database = openDatabase();
    const baselineSpace = database.getLocalSpace();

    expect(baselineSpace.id).toMatch(/^space_[a-f0-9]{32}$/);
    expect(database.db.prepare("SELECT value FROM app_meta WHERE key = 'product_data_baseline'").get()).toEqual({
      value: '0.3.0',
    });
    expect(database.db.prepare("SELECT value FROM app_meta WHERE key = 'database_schema_revision'").get()).toEqual({
      value: '1',
    });
    expect(
      database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(),
    ).toBeUndefined();

    registerPack(database, 'pack-space-cascade');
    database.registerPackRelease(releaseInput('pack-space-cascade', '0.1.0'));
    const attempt = database.beginPackInstallAttempt({
      packId: 'pack-space-cascade',
      targetReleaseId: 'release-pack-space-cascade-0.1.0',
      operation: 'INSTALL',
    });
    database.completePackInstallAttempt(attempt.id);

    const aligned = database.synchronizeLocalSpaceIdentity({
      id: 'registry-space-id',
      name: 'Registry Space',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(aligned).toMatchObject({ id: 'registry-space-id', name: 'Registry Space' });
    expect(database.listPackInstallations()).toEqual([
      expect.objectContaining({ spaceId: 'registry-space-id', packId: 'pack-space-cascade' }),
    ]);
    expect(database.db.prepare("SELECT value FROM app_meta WHERE key = 'local_space_id'").get()).toEqual({
      value: 'registry-space-id',
    });
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM prompt_series').get()).toEqual({ count: 0 });
    database.close();
  });

  it('registers an idempotent sealed release and rejects mutations to its header, items, and dependencies', () => {
    const database = openDatabase();
    registerPack(database, 'pack-foundation');
    registerPack(database, 'pack-portrait');
    database.registerPackRelease(releaseInput('pack-foundation', '0.1.0'));
    const input = releaseInput('pack-portrait', '0.1.0', {
      manifest: { version: '0.1.0', packId: 'pack-portrait' },
      compatibility: { app: '>=0.3.0' },
      dependencies: [
        {
          id: 'dependency-portrait-foundation',
          targetPackId: 'pack-foundation',
          kind: 'REQUIRED',
          versionRange: '^0.1.0',
          lockedReleaseId: 'release-pack-foundation-0.1.0',
          suggestedRoles: ['SUBJECT'],
        },
      ],
    });

    const release = database.registerPackRelease(input);
    expect(release).toMatchObject({
      id: 'release-pack-portrait-0.1.0',
      contentHash: 'sha256:pack-portrait-0.1.0',
      items: [{ id: 'item-pack-portrait-0.1.0', sortOrder: 0 }],
      dependencies: [{ id: 'dependency-portrait-foundation', lockedReleaseId: 'release-pack-foundation-0.1.0' }],
    });
    expect(database.registerPackRelease(input)).toEqual(release);
    expect(() => database.registerPackRelease({ ...input, contentHash: 'sha256:different' })).toThrow(
      'Immutable pack release conflicts',
    );
    expect(() =>
      database.db.prepare("UPDATE pack_releases SET version = '0.2.9' WHERE id = ?").run(release.id),
    ).toThrow('pack release is immutable');
    expect(() =>
      database.db
        .prepare("UPDATE pack_release_items SET rights_status = 'CLEAR' WHERE id = ?")
        .run(release.items[0].id),
    ).toThrow('pack release item is immutable');
    expect(() =>
      database.db
        .prepare(
          `INSERT INTO pack_dependencies
      (id, release_id, target_pack_id, dependency_kind, version_range, locked_release_id,
        suggested_roles_json, capability_key, metadata_json, sort_order, created_at)
      VALUES ('late-dependency', ?, 'pack-foundation', 'OPTIONAL', '*', NULL, '[]', '', '{}', 1, ?)`,
        )
        .run(release.id, new Date().toISOString()),
    ).toThrow('pack dependency baseline is sealed');
    expect(() =>
      database.registerPackRelease(
        releaseInput('pack-foundation', '0.2.0', {
          dependencies: [
            {
              targetPackId: 'pack-foundation',
              kind: 'REQUIRED',
              versionRange: '*',
            },
          ],
        }),
      ),
    ).toThrow('Required pack dependency cycle detected');
    database.close();
  });

  it('keeps installation state separate from attempts and preserves a usable release after a failed upgrade', () => {
    const database = openDatabase();
    registerPack(database, 'pack-dependency');
    registerPack(database, 'pack-main');
    database.registerPackRelease(releaseInput('pack-dependency', '0.1.0'));
    database.registerPackRelease(releaseInput('pack-dependency', '0.2.0'));
    database.registerPackRelease(
      releaseInput('pack-main', '0.1.0', {
        dependencies: [
          {
            id: 'dependency-main-v1',
            targetPackId: 'pack-dependency',
            kind: 'REQUIRED',
            versionRange: '0.1.0',
            lockedReleaseId: 'release-pack-dependency-0.1.0',
          },
        ],
      }),
    );
    database.registerPackRelease(
      releaseInput('pack-main', '0.2.0', {
        dependencies: [
          {
            id: 'dependency-main-v2',
            targetPackId: 'pack-dependency',
            kind: 'REQUIRED',
            versionRange: '0.2.0',
            lockedReleaseId: 'release-pack-dependency-0.2.0',
          },
        ],
      }),
    );

    const firstMainAttempt = database.beginPackInstallAttempt({
      packId: 'pack-main',
      targetReleaseId: 'release-pack-main-0.1.0',
      operation: 'INSTALL',
      dependencies: [
        {
          dependencyId: 'dependency-main-v1',
          resolutionKind: 'LOCKED',
          resolvedReleaseId: 'release-pack-dependency-0.1.0',
        },
      ],
    });
    expect(() => database.completePackInstallAttempt(firstMainAttempt.id)).toThrow('Dependency is not installed');
    expect(database.failPackInstallAttempt(firstMainAttempt.id, { code: 'MISSING_DEPENDENCY' })).toMatchObject({
      state: 'FAILED_NO_USABLE_RELEASE',
      selectedReleaseId: null,
    });
    expect(database.getPackInstallAttempt(firstMainAttempt.id).status).toBe('FAILED');

    const dependencyAttempt = database.beginPackInstallAttempt({
      packId: 'pack-dependency',
      targetReleaseId: 'release-pack-dependency-0.1.0',
      operation: 'INSTALL',
    });
    database.completePackInstallAttempt(dependencyAttempt.id);
    const mainAttempt = database.beginPackInstallAttempt({
      packId: 'pack-main',
      targetReleaseId: 'release-pack-main-0.1.0',
      operation: 'INSTALL',
      dependencies: [
        {
          dependencyId: 'dependency-main-v1',
          resolutionKind: 'LOCKED',
          resolvedReleaseId: 'release-pack-dependency-0.1.0',
        },
      ],
    });
    expect(database.completePackInstallAttempt(mainAttempt.id)).toMatchObject({
      state: 'INSTALLED',
      selectedReleaseId: 'release-pack-main-0.1.0',
    });

    const upgradeAttempt = database.beginPackInstallAttempt({
      packId: 'pack-main',
      targetReleaseId: 'release-pack-main-0.2.0',
      operation: 'UPGRADE',
      dependencies: [
        {
          dependencyId: 'dependency-main-v2',
          resolutionKind: 'LOCKED',
          resolvedReleaseId: 'release-pack-dependency-0.2.0',
        },
      ],
    });
    expect(database.listPackInstallations().find((item) => item.packId === 'pack-main')).toMatchObject({
      state: 'UPDATING',
      selectedReleaseId: 'release-pack-main-0.1.0',
    });
    expect(() => database.completePackInstallAttempt(upgradeAttempt.id)).toThrow('Dependency is not installed');
    expect(database.failPackInstallAttempt(upgradeAttempt.id, { code: 'UPGRADE_DEPENDENCY_FAILED' })).toMatchObject({
      state: 'INSTALLED',
      selectedReleaseId: 'release-pack-main-0.1.0',
    });
    expect(database.listPackCatalog().find((item) => item.pack.id === 'pack-main')).toMatchObject({
      releases: [{ version: '0.2.0' }, { version: '0.1.0' }],
      installation: { selectedReleaseId: 'release-pack-main-0.1.0' },
    });
    database.close();
  });

  it('pins context activation to an exact release and stores local overrides without mutating the baseline', () => {
    const database = openDatabase();
    registerPack(database, 'pack-context');
    const release = database.registerPackRelease(releaseInput('pack-context', '0.1.0'));
    const attempt = database.beginPackInstallAttempt({
      packId: 'pack-context',
      targetReleaseId: release.id,
      operation: 'INSTALL',
    });
    database.completePackInstallAttempt(attempt.id);

    const activation = database.upsertContextPackActivation({
      id: 'activation-album-pack',
      targetType: 'ALBUM',
      targetId: 'album-1',
      packId: 'pack-context',
      packReleaseId: release.id,
      roles: ['SUBJECT', 'METHOD', 'SUBJECT'],
      priority: 10,
      state: 'EXPLICIT_ACTIVE',
      source: 'USER',
    });
    expect(activation).toMatchObject({
      id: 'activation-album-pack',
      packReleaseId: release.id,
      roles: ['SUBJECT', 'METHOD'],
    });

    const localOverride = database.upsertLocalOverride({
      id: 'override-context-item',
      baseReleaseItemId: release.items[0].id,
      overrideKind: 'REPLACE',
      localObjectType: 'TERM_REVISION',
      localRevisionId: 'local-term-revision-1',
      localContentHash: 'sha256:local-term-revision-1',
      patch: { promptFragment: 'local expression' },
      scopeType: 'ALBUM',
      scopeId: 'album-1',
      state: 'ACTIVE',
    });
    expect(localOverride.id).toBe('override-context-item');
    expect(database.getPackRelease(release.id).items[0]).toEqual(release.items[0]);

    database.deleteContextPackActivation(activation.id);
    database.deleteLocalOverride(localOverride.id);
    expect(database.listContextPackActivations('ALBUM', 'album-1')).toEqual([]);
    expect(database.listLocalOverrides()).toEqual([]);
    expect(
      database.db
        .prepare(
          `SELECT entity_type, entity_id FROM tombstones
      WHERE entity_id IN (?, ?) ORDER BY entity_type`,
        )
        .all(activation.id, localOverride.id),
    ).toEqual([
      { entity_type: 'CONTEXT_PACK_ACTIVATION', entity_id: activation.id },
      { entity_type: 'LOCAL_OVERRIDE', entity_id: localOverride.id },
    ]);
    database.close();
  });
});
