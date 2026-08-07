import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryRegistry, libraryDatabasePath } from '@/main/libraries/library-registry';

const roots: string[] = [];

function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-library-registry-'));
  roots.push(root);
  return root;
}

function touchDatabase(root: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'library.sqlite3'), 'sqlite-placeholder');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('LibraryRegistry', () => {
  it('creates a default library without asking for a folder on first launch', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    const current = registry.initialize('默认资料库');

    expect(current.name).toBe('默认资料库');
    expect(current.rootPath).toBe(path.join(userDataRoot, 'libraries', current.id));
    expect(current.templateKey).toBeNull();
    expect(existsSync(path.join(current.rootPath, 'library.json'))).toBe(true);
    expect(existsSync(path.join(userDataRoot, 'libraries', 'index.json'))).toBe(true);
  });

  it('keeps the pre-registry folder isolated from the v0.3 library index', () => {
    const userDataRoot = temporaryRoot();
    const legacyRoot = path.join(userDataRoot, 'library');
    touchDatabase(legacyRoot);

    const current = new LibraryRegistry(userDataRoot).initialize();

    expect(current.rootPath).toBe(path.join(userDataRoot, 'libraries', current.id));
    expect(current.templateKey).toBeNull();
    expect(existsSync(path.join(legacyRoot, 'library.sqlite3'))).toBe(true);
    expect(existsSync(libraryDatabasePath(current))).toBe(false);
  });

  it('registers an existing library once and persists the current selection', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    const initial = registry.initialize();
    touchDatabase(initial.rootPath);
    const externalRoot = path.join(temporaryRoot(), 'anime-library');
    touchDatabase(externalRoot);

    const registered = registry.registerExisting(externalRoot);
    expect(registry.registerExisting(externalRoot).id).toBe(registered.id);
    registry.setCurrent(registered.id);

    const reopened = new LibraryRegistry(userDataRoot);
    expect(reopened.initialize().id).toBe(registered.id);
    expect(reopened.list().libraries).toHaveLength(2);
    expect(reopened.list().libraries.find((library) => library.id === registered.id)).toMatchObject({
      isCurrent: true,
      available: true,
    });
  });

  it('creates and selects a distinct empty library', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    const initial = registry.initialize('默认资料库');
    const created = registry.create('新资料库');

    expect(created).toMatchObject({ name: '新资料库', templateKey: null });
    expect(created.id).not.toBe(initial.id);
    expect(existsSync(path.join(created.rootPath, 'library.json'))).toBe(true);
    expect(new LibraryRegistry(userDataRoot).initialize().id).toBe(created.id);
    expect(registry.listSpaces()).toEqual({
      currentSpaceId: created.id,
      spaces: expect.arrayContaining([
        expect.objectContaining({ id: initial.id, name: '默认资料库', isCurrent: false }),
        expect.objectContaining({ id: created.id, name: '新资料库', isCurrent: true }),
      ]),
    });
  });

  it('publishes registry mutations in memory only after persistence succeeds', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    const initial = registry.initialize('稳定空间');
    const mutableRegistry = registry as unknown as { saveState(state: unknown): void };
    mutableRegistry.saveState = () => {
      throw new Error('forced registry commit failure');
    };

    expect(() => registry.create('幽灵空间')).toThrow('forced registry commit failure');
    expect(registry.listSpaces()).toMatchObject({
      currentSpaceId: initial.id,
      spaces: [{ id: initial.id, name: '稳定空间', isCurrent: true }],
    });
    expect(() => registry.updateCurrentName('错误名称')).toThrow('forced registry commit failure');
    expect(registry.getCurrent()).toMatchObject({ id: initial.id, name: '稳定空间' });
  });

  it('preserves unknown manifest extensions when registering a local space', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    registry.initialize();
    const externalRoot = path.join(temporaryRoot(), 'extended-space');
    touchDatabase(externalRoot);
    writeFileSync(
      path.join(externalRoot, 'library.json'),
      JSON.stringify({
        version: 1,
        id: 'extended-space',
        name: '扩展空间',
        extension: { owner: 'user' },
      }),
    );

    registry.registerExisting(externalRoot);

    expect(JSON.parse(readFileSync(path.join(externalRoot, 'library.json'), 'utf8'))).toMatchObject({
      id: 'extended-space',
      name: '扩展空间',
      extension: { owner: 'user' },
    });
  });

  it('rejects a second path claiming an existing local-space identity', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    const current = registry.initialize();
    const duplicateRoot = path.join(temporaryRoot(), 'identity-copy');
    touchDatabase(duplicateRoot);
    writeFileSync(
      path.join(duplicateRoot, 'library.json'),
      JSON.stringify({
        version: 1,
        id: current.id,
        name: '身份副本',
      }),
    );

    expect(() => registry.registerExisting(duplicateRoot)).toThrow('Local space identity is already registered');
    expect(registry.listSpaces().spaces).toHaveLength(1);
  });

  it('preserves a historical template key only as inert provenance', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    const current = registry.initialize();
    const registryPath = path.join(userDataRoot, 'libraries', 'index.json');
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      libraries: Array<{ id: string; templateKey: string | null }>;
    };
    persisted.libraries.find((library) => library.id === current.id)!.templateKey = 'retired-template';
    writeFileSync(registryPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

    expect(new LibraryRegistry(userDataRoot).initialize().templateKey).toBe('retired-template');
  });

  it('recovers a truncated registry from its most recent valid backup', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    registry.initialize('初始空间');
    registry.updateCurrentName('已保存空间');

    // A clean reopen advances the backup to the latest committed state.
    expect(new LibraryRegistry(userDataRoot).initialize().name).toBe('已保存空间');
    const librariesRoot = path.join(userDataRoot, 'libraries');
    const registryPath = path.join(librariesRoot, 'index.json');
    const backupRegistryPath = `${registryPath}.bak`;
    expect(existsSync(backupRegistryPath)).toBe(true);
    expect(JSON.parse(readFileSync(backupRegistryPath, 'utf8'))).toMatchObject({
      libraries: [expect.objectContaining({ name: '已保存空间' })],
    });

    writeFileSync(registryPath, '{"version": 1, "libraries": [', 'utf8');
    const recovered = new LibraryRegistry(userDataRoot);

    expect(recovered.initialize().name).toBe('已保存空间');
    expect(JSON.parse(readFileSync(registryPath, 'utf8'))).toMatchObject({
      currentLibraryId: recovered.getCurrent().id,
      libraries: [expect.objectContaining({ name: '已保存空间' })],
    });
    expect(readdirSync(librariesRoot).filter((name) => name.endsWith('.tmp') || name.endsWith('.replaced'))).toEqual(
      [],
    );
    expect(readdirSync(librariesRoot).filter((name) => name.startsWith('index.json.corrupt-'))).toHaveLength(1);
  });

  it('skips malformed registry entries when no valid backup is available', () => {
    const userDataRoot = temporaryRoot();
    const librariesRoot = path.join(userDataRoot, 'libraries');
    const validRoot = path.join(librariesRoot, 'valid-space');
    mkdirSync(validRoot, { recursive: true });
    writeFileSync(
      path.join(librariesRoot, 'index.json'),
      JSON.stringify({
        version: 1,
        currentLibraryId: 'broken-space',
        libraries: [
          {
            id: 'valid-space',
            name: '有效空间',
            rootPath: validRoot,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            templateKey: null,
          },
          {
            id: 'broken-space',
            name: '损坏空间',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      'utf8',
    );

    const registry = new LibraryRegistry(userDataRoot);
    expect(registry.initialize()).toMatchObject({ id: 'valid-space', rootPath: validRoot });
    expect(registry.listSpaces().spaces).toEqual([expect.objectContaining({ id: 'valid-space', isCurrent: true })]);
  });

  it('fails closed without changing either file when both primary and backup are invalid', () => {
    const userDataRoot = temporaryRoot();
    const librariesRoot = path.join(userDataRoot, 'libraries');
    mkdirSync(librariesRoot, { recursive: true });
    const registryPath = path.join(librariesRoot, 'index.json');
    const backupRegistryPath = path.join(librariesRoot, 'index.json.bak');
    const primaryContents = '{';
    const backupContents = '[]';
    writeFileSync(registryPath, primaryContents, 'utf8');
    writeFileSync(backupRegistryPath, backupContents, 'utf8');

    const registry = new LibraryRegistry(userDataRoot);
    expect(() => registry.initialize('恢复空间')).toThrowError(
      expect.objectContaining({ code: 'LIBRARY_REGISTRY_CORRUPT' }),
    );
    expect(readFileSync(registryPath, 'utf8')).toBe(primaryContents);
    expect(readFileSync(backupRegistryPath, 'utf8')).toBe(backupContents);
    expect(readdirSync(librariesRoot).sort()).toEqual(['index.json', 'index.json.bak']);
  });

  it('recovers a corrupted library manifest without losing valid extensions', () => {
    const externalRoot = path.join(temporaryRoot(), 'recoverable-space');
    touchDatabase(externalRoot);
    const manifestPath = path.join(externalRoot, 'library.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        id: 'recoverable-space',
        name: '可恢复空间',
        extension: { owner: 'user' },
      }),
      'utf8',
    );

    const firstRegistry = new LibraryRegistry(temporaryRoot());
    firstRegistry.initialize();
    firstRegistry.registerExisting(externalRoot);
    expect(existsSync(`${manifestPath}.bak`)).toBe(true);
    // Syntactically valid JSON is not enough: an empty primary must not hide
    // the complete identity in the last valid backup.
    writeFileSync(manifestPath, '{}', 'utf8');

    const secondRegistry = new LibraryRegistry(temporaryRoot());
    secondRegistry.initialize();
    expect(secondRegistry.registerExisting(externalRoot)).toMatchObject({
      id: 'recoverable-space',
      name: '可恢复空间',
    });
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
      id: 'recoverable-space',
      name: '可恢复空间',
      extension: { owner: 'user' },
    });
  });

  it('removes its temporary file when flushing fails', async () => {
    const userDataRoot = temporaryRoot();
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...actualFs,
      fsyncSync: vi.fn(() => {
        throw Object.assign(new Error('forced fsync failure'), { code: 'EIO' });
      }),
    }));

    try {
      const { LibraryRegistry: FailingLibraryRegistry } = await import('../src/main/libraries/library-registry');
      expect(() => new FailingLibraryRegistry(userDataRoot).initialize()).toThrow('forced fsync failure');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }

    const librariesRoot = path.join(userDataRoot, 'libraries');
    const entries = readdirSync(librariesRoot, { recursive: true, encoding: 'utf8' });
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('does not misclassify a directory fsync failure as a rename failure', async () => {
    const userDataRoot = temporaryRoot();
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    let fsyncCalls = 0;
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...actualFs,
      fsyncSync: vi.fn(() => {
        fsyncCalls += 1;
        if (fsyncCalls === 2) {
          throw Object.assign(new Error('forced directory fsync failure'), { code: 'EIO' });
        }
      }),
    }));

    try {
      const { LibraryRegistry: FailingLibraryRegistry } = await import('../src/main/libraries/library-registry');
      expect(() => new FailingLibraryRegistry(userDataRoot).initialize()).toThrow('forced directory fsync failure');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }

    const entries = readdirSync(path.join(userDataRoot, 'libraries'), { recursive: true, encoding: 'utf8' });
    expect(entries.filter((entry) => entry.endsWith('.tmp') || entry.endsWith('.replaced'))).toEqual([]);
  });

  it('rejects folders that are not desktop libraries', () => {
    const userDataRoot = temporaryRoot();
    const registry = new LibraryRegistry(userDataRoot);
    registry.initialize();
    const folder = temporaryRoot();

    expect(() => registry.registerExisting(folder)).toThrow('library.sqlite3 was not found');
  });
});
