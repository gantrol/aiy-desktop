import path from 'node:path';
import { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { GenerationService } from '@/main/generation/service';
import { TermIllustrationService } from '@/main/dictionary/term-illustration-service';
import { readDictionaryImport } from '@/main/dictionary/dictionary-import';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { dictionarySaveDraftSchema } from '@/main/ipc/schemas/creation-generation-schemas';
import {
  termIllustrationAdoptInputSchema,
  termIllustrationDismissInputSchema,
  termIllustrationListInputSchema,
  termIllustrationStartInputSchema,
} from '@/shared/contracts/term-illustration';

interface DictionaryFileSelection {
  canceled: boolean;
  filePaths: string[];
}

const localeSchema = z.enum(['zh', 'en']);
const contentLocaleSchema = z.string().trim().min(1).max(64);
const id = z.string().min(1).max(200);
const stringList = z.array(z.string().max(500)).max(100);
const searchSchema = z.object({
  locale: localeSchema,
  query: z.string().max(500),
  facetValueIds: stringList,
  missingFacetSystemRoles: z
    .array(z.enum(['PRIMARY_CLASSIFICATION', 'SECONDARY_CLASSIFICATION']))
    .max(2)
    .optional()
    .default([]),
  classificationIds: stringList.optional().default([]),
  missingClassification: z.boolean().optional().default(false),
  termIds: stringList.optional().default([]),
  excludeDrafts: z.boolean(),
  excludeUncited: z.boolean(),
  includeArchived: z.boolean(),
  packReleaseIds: z.array(id).max(50).optional(),
  includeLocalTerms: z.boolean().optional().default(true),
});
const pageSearchSchema = searchSchema.extend({
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
  prioritizeTermId: id.optional(),
});
const newTermSchema = z
  .object({
    title: z.string().min(1).max(300),
    titleLocale: contentLocaleSchema,
    uiLocale: localeSchema,
    classificationId: id.nullable().optional(),
  })
  .refine((value) => Boolean(value.title.trim()), {
    message: 'Title is required',
  });
const addTermMediaSchema = z.object({
  termId: id,
  assetIds: z.array(id).min(1).max(50),
  preferredRole: z.enum(['COVER', 'RELATED']).optional(),
});
const reorderTermMediaSchema = z.object({ termId: id, mediaIds: z.array(id).max(100) });
const classificationNamesSchema = {
  name: z.string().trim().min(1).max(160),
  nameLocale: contentLocaleSchema,
  localizations: z
    .array(z.object({ locale: contentLocaleSchema, name: z.string().trim().min(1).max(160) }).strict())
    .max(100),
};
const classificationCreateSchema = z
  .object({ parentId: id.nullable(), ...classificationNamesSchema, locale: localeSchema })
  .strict();
const classificationUpdateSchema = z.object({ id, ...classificationNamesSchema, locale: localeSchema }).strict();
const classificationRestoreSourceSchema = z.object({ id, locale: localeSchema }).strict();
const classificationMoveSchema = z.object({ id, parentId: id.nullable(), locale: localeSchema }).strict();
const classificationReorderSchema = z
  .object({ parentId: id.nullable(), orderedIds: z.array(id).max(500), locale: localeSchema })
  .strict();
const classificationSetStateSchema = z
  .object({
    id,
    state: z.enum(['ACTIVE', 'DISABLED']),
    includeDescendants: z.boolean().optional().default(false),
    locale: localeSchema,
  })
  .strict();
const classificationMergeSchema = z
  .object({
    sourceId: id,
    targetId: id,
    conflictResolutions: z
      .array(
        z
          .object({
            sourceChildId: id,
            targetChildId: id,
            action: z.enum(['KEEP_BOTH', 'RENAME', 'MERGE']),
            renamedName: z.string().trim().min(1).max(160).optional(),
          })
          .strict(),
      )
      .max(200)
      .optional()
      .default([]),
    locale: localeSchema,
  })
  .strict();
const classificationTermsSchema = z
  .object({
    classificationId: id,
    includeDescendants: z.boolean(),
    locale: localeSchema,
    query: z.string().max(500),
    limit: z.number().int().min(1).max(200),
  })
  .strict();
const dictionaryScopeResolveSchema = z.object({
  packReleaseIds: z.array(id).max(50),
  includeLocalTerms: z.boolean(),
});
const paletteContentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TEXT'),
    promptFragment: z.string().max(30_000),
    negativeFragment: z.string().max(30_000),
  }),
  z.object({ kind: z.literal('TERM'), termId: id }),
]);
const palettePromptNodeSchema = z.discriminatedUnion('kind', [
  ...paletteContentSchema.options,
  z.object({ kind: z.literal('SLOT'), stableKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/) }),
]);
const paletteLocalizationSchema = z
  .object({ locale: contentLocaleSchema, name: z.string().min(1).max(200), description: z.string().max(1000) })
  .strict();
const paletteParameterLocalizationSchema = z
  .object({ locale: contentLocaleSchema, name: z.string().min(1).max(120) })
  .strict();
const paletteOptionLocalizationSchema = z
  .object({ locale: contentLocaleSchema, label: z.string().min(1).max(120) })
  .strict();
const paletteParameterSchema = z.object({
  stableKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  name: z.string().min(1).max(120),
  nameLocale: contentLocaleSchema,
  localizations: z.array(paletteParameterLocalizationSchema).max(20),
  required: z.boolean(),
  options: z
    .array(
      z.object({
        value: z.string().min(1).max(120),
        label: z.string().min(1).max(120),
        labelLocale: contentLocaleSchema,
        localizations: z.array(paletteOptionLocalizationSchema).max(20),
        contents: z.array(paletteContentSchema).max(100),
      }),
    )
    .min(1)
    .max(100),
});
const paletteFields = {
  locale: localeSchema,
  name: z.string().min(1).max(200),
  nameLocale: contentLocaleSchema,
  description: z.string().max(1000),
  localizations: z.array(paletteLocalizationSchema).max(20),
  referenceAssetIds: z.array(id).max(16),
  parameters: z.array(paletteParameterSchema).max(12),
  promptNodes: z.array(palettePromptNodeSchema).max(2000),
};
const createPaletteSchema = z.object(paletteFields).strict();
const updatePaletteSchema = z.object({ paletteId: id, ...paletteFields }).strict();

export function registerDictionaryIpc(
  ipcMain: IpcHandlerRegistrar,
  database: LibraryDatabase,
  chooseDictionaryFile: () => Promise<DictionaryFileSelection>,
  backgroundTasks?: Pick<GenerationService, 'stageDictionaryImport' | 'commitDictionaryImport'> &
    Partial<Pick<GenerationService, 'imageGenerationRoutes' | 'startBatch' | 'cancel'>>,
) {
  const termIllustrationService = () => {
    if (!backgroundTasks?.imageGenerationRoutes || !backgroundTasks.startBatch || !backgroundTasks.cancel) {
      throw new Error('Image generation service is unavailable');
    }
    return new TermIllustrationService(database, {
      imageGenerationRoutes: backgroundTasks.imageGenerationRoutes,
      startBatch: (input) => backgroundTasks.startBatch!(input),
      cancel: (runId) => backgroundTasks.cancel!(runId),
    });
  };
  ipcMain.handle('dictionary:search', (_event, raw) => {
    const input = searchSchema.parse(raw);
    return database.searchTerms(input.locale, input.query, input.facetValueIds, input);
  });
  ipcMain.handle('dictionary:details', (_event, rawLocale) => {
    const locale = localeSchema.parse(rawLocale);
    const terms = database.searchTerms(locale);
    return { terms, wordPalettes: database.getWordPalettes(locale, terms) };
  });
  ipcMain.handle('dictionary:search-page', (_event, raw) => database.searchTermsPage(pageSearchSchema.parse(raw)));
  ipcMain.handle('dictionary:scope-resolve', (_event, raw) =>
    database.resolveDictionaryScope(dictionaryScopeResolveSchema.parse(raw)),
  );
  ipcMain.handle('dictionary:get', (_event, rawId, rawLocale) =>
    database.getTerm(id.parse(rawId), localeSchema.parse(rawLocale)),
  );
  ipcMain.handle('dictionary:create', (_event, raw) => database.createTerm(newTermSchema.parse(raw)));
  ipcMain.handle('dictionary:save-draft', (_event, raw) => {
    const input = dictionarySaveDraftSchema.parse(raw);
    return database.saveTermDraft(input.draft, input.locale);
  });
  ipcMain.handle('dictionary:approve', (_event, rawId, rawLocale) =>
    database.approveTerm(id.parse(rawId), localeSchema.parse(rawLocale)),
  );
  ipcMain.handle('dictionary:withdraw-approval', (_event, rawId, rawLocale) =>
    database.withdrawTermApproval(id.parse(rawId), localeSchema.parse(rawLocale)),
  );
  ipcMain.handle('dictionary:set-archived', (_event, rawId, rawArchived, rawLocale) =>
    database.setTermArchived(id.parse(rawId), z.boolean().parse(rawArchived), localeSchema.parse(rawLocale)),
  );
  ipcMain.handle('dictionary:add-media', (_event, raw) => database.addTermMedia(addTermMediaSchema.parse(raw)));
  ipcMain.handle('dictionary:set-media-cover', (_event, rawId) => database.setTermMediaCover(id.parse(rawId)));
  ipcMain.handle('dictionary:remove-media', (_event, rawId) => database.removeTermMedia(id.parse(rawId)));
  ipcMain.handle('dictionary:reorder-media', (_event, raw) =>
    database.reorderTermMedia(reorderTermMediaSchema.parse(raw)),
  );
  ipcMain.handle('term-illustrations:list', (_event, raw) =>
    database.listTermIllustrations(termIllustrationListInputSchema.parse(raw)),
  );
  ipcMain.handle('term-illustrations:start', (_event, raw) =>
    termIllustrationService().start(termIllustrationStartInputSchema.parse(raw)),
  );
  ipcMain.handle('term-illustrations:adopt', (_event, raw) =>
    database.adoptTermIllustration(termIllustrationAdoptInputSchema.parse(raw)),
  );
  ipcMain.handle('term-illustrations:dismiss', (_event, raw) =>
    database.dismissTermIllustration(termIllustrationDismissInputSchema.parse(raw).batchRunId),
  );
  ipcMain.handle('dictionary-classifications:tree', (_event, rawLocale) =>
    database.listDictionaryClassifications(localeSchema.parse(rawLocale)),
  );
  ipcMain.handle('dictionary-classifications:terms', (_event, raw) =>
    database.listDictionaryClassificationTerms(classificationTermsSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:create', (_event, raw) =>
    database.createDictionaryClassification(classificationCreateSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:update', (_event, raw) =>
    database.updateDictionaryClassification(classificationUpdateSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:restore-source', (_event, raw) =>
    database.restoreDictionaryClassificationSource(classificationRestoreSourceSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:move-preview', (_event, raw) =>
    database.previewDictionaryClassificationMove(classificationMoveSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:move', (_event, raw) =>
    database.moveDictionaryClassification(classificationMoveSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classifications:reorder', (_event, raw) =>
    database.reorderDictionaryClassifications(classificationReorderSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:set-state', (_event, raw) =>
    database.setDictionaryClassificationState(classificationSetStateSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:merge-preview', (_event, raw) =>
    database.previewDictionaryClassificationMerge(classificationMergeSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-classification:merge', (_event, raw) =>
    database.mergeDictionaryClassification(classificationMergeSchema.parse(raw)),
  );
  ipcMain.handle('dictionary:choose-import', async () => {
    const result = await chooseDictionaryFile();
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath) || 'dictionary';
    return backgroundTasks?.stageDictionaryImport
      ? backgroundTasks.stageDictionaryImport(fileName, filePath)
      : database.stageImport(fileName, readDictionaryImport(filePath));
  });
  ipcMain.handle('dictionary:commit-import', (_event, rawId) => {
    const batchId = id.parse(rawId);
    return backgroundTasks?.commitDictionaryImport
      ? backgroundTasks.commitDictionaryImport(batchId)
      : database.commitImport(batchId);
  });
  ipcMain.handle('word-palette:create', (_event, raw) => database.createWordPalette(createPaletteSchema.parse(raw)));
  ipcMain.handle('word-palette:update', (_event, raw) => database.updateWordPalette(updatePaletteSchema.parse(raw)));
  ipcMain.handle('word-palette:set-archived', (_event, rawId, rawArchived) =>
    database.setWordPaletteArchived(id.parse(rawId), z.boolean().parse(rawArchived)),
  );
  ipcMain.handle('word-palette:delete', (_event, rawId) => database.deleteWordPalette(id.parse(rawId)));
}
