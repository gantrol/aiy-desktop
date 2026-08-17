import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '@/main/database';

const temporaryRoots: string[] = [];

describe('startup storage smoke', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('opens an empty local space and builds the core bootstrap projection', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'aiy-startup-smoke-'));
    temporaryRoots.push(root);
    const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root, { openMode: 'create' });

    try {
      database.initialize('Startup smoke', undefined, {
        recoverGenerationRuns: false,
        recoverAssistantRuns: false,
      });
      const locale = 'en' as const;
      const terms = database.searchTerms(locale);
      const projection = {
        terms,
        categories: database.getCategories(locale),
        facets: database.getFacets(locale),
        wordPalettes: database.getWordPalettes(locale, terms),
        ...database.getWorkbench(locale, { includeExecutionActualRequest: false }),
        assistantRuns: database.listAssistantRuns(),
        creations: database.listCreations(),
        styleExplorationBatches: database.listStyleExplorationBatches(),
        agentTasks: database.listDirectionExperimentDirectorTasks(),
        libraryEmpty: database.isLibraryEmpty(),
        creationDraft: database.getCreationDraft(),
      };

      expect(projection.libraryEmpty).toBe(true);
    } finally {
      database.close();
    }
  });
});
