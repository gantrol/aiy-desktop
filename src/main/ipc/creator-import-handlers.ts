import { z } from 'zod';
import type { CreatorImageImportItemInput } from '@/shared/contracts';
import { CreatorImageStagingService } from '@/main/creations/creator-image-staging';
import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { importedImageMetadataSchema } from '@/main/ipc/import-metadata-schema';

interface ImageSelection {
  canceled: boolean;
  filePaths: string[];
}

const id = z.string().min(1).max(200);
const imageBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024, {
    message: 'Image must be 25 MB or smaller',
  });
const importContextSchema = z.object({
  seriesId: id.nullable(),
  versionId: id.nullable(),
  title: z.string().max(300),
  titleLocale: z.enum(['zh', 'en']),
  source: z.enum(['PASTE', 'DROP', 'UPLOAD']),
  sourceUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' })
    .optional()
    .default(''),
});
const imageItemSchema = z.object({
  id,
  name: z.string().min(1).max(500),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: imageBytesSchema,
  metadata: importedImageMetadataSchema.optional(),
});
const imageItemsSchema = z
  .array(imageItemSchema)
  .min(1)
  .max(8)
  .refine((items) => items.reduce((total, item) => total + item.bytes.byteLength, 0) <= 100 * 1024 * 1024, {
    message: 'Import must be 100 MB or smaller',
  });
const imageImportSchema = z.object({ context: importContextSchema, items: imageItemsSchema });
const stagedImageImportSchema = z
  .object({
    context: importContextSchema,
    stageIds: z.array(id).min(1).max(8),
  })
  .strict();
const stageIdsSchema = z.array(id).max(8);
const imageChooseSchema = z.object({ context: importContextSchema });
const newExternalCreationImportSchema = z
  .object({
    intent: z.literal('NEW_EXTERNAL_CREATION'),
    sourceKind: z.enum(['EXTERNAL_IMPORT', 'MANUAL_PROMPT']).optional().default('EXTERNAL_IMPORT'),
    creationDraftId: id.nullable().optional().default(null),
    albumId: id.nullable().optional().default(null),
    title: z.string().max(300),
    titleLocale: z.enum(['zh', 'en']),
    prompt: z.discriminatedUnion('knowledge', [
      z.object({ knowledge: z.literal('UNKNOWN') }),
      z.object({ knowledge: z.literal('EXACT'), text: z.string().trim().min(1).max(30_000) }),
    ]),
    source: z.enum(['PASTE', 'DROP', 'UPLOAD']).optional().default('UPLOAD'),
    sourceUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' })
      .optional()
      .default(''),
    outputs: z.array(imageItemSchema).max(8),
  })
  .superRefine((value, context) => {
    if (value.sourceKind === 'MANUAL_PROMPT' && value.prompt.knowledge !== 'EXACT') {
      context.addIssue({
        code: 'custom',
        path: ['prompt'],
        message: 'A manual Prompt creation requires an exact Prompt',
      });
    }
    if (value.creationDraftId && value.sourceKind !== 'MANUAL_PROMPT') {
      context.addIssue({
        code: 'custom',
        path: ['creationDraftId'],
        message: 'Only a manual Prompt creation can consume a creation draft',
      });
    }
    if (value.outputs.reduce((total, item) => total + item.bytes.byteLength, 0) > 100 * 1024 * 1024) {
      context.addIssue({ code: 'custom', path: ['outputs'], message: 'Import must be 100 MB or smaller' });
    }
  });
const outputUpdateSchema = z.object({
  outputId: id,
  promptVersionId: id.nullable(),
  displayName: z.string().min(1).max(500),
  note: z.string().max(4000),
  sourceUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' }),
  aiGeneratedStatus: z.enum(['YES', 'NO', 'UNKNOWN', 'OTHER']),
  comparisonRole: z.enum(['MODEL', 'UNKNOWN', 'ACTUAL']),
  modelName: z.string().max(300),
  modelProvider: z.string().max(200),
  modelVersion: z.string().max(200),
  generationTextType: z.enum(['EXACT_PROMPT', 'DESCRIPTION', 'RECONSTRUCTION', 'UNKNOWN']),
  generationText: z.string().max(30_000),
});

export function registerCreatorImportIpc(
  ipcMain: IpcHandlerRegistrar,
  database: LibraryDatabase,
  chooseImages: () => Promise<ImageSelection>,
) {
  const stages = new CreatorImageStagingService(() => database);
  const stageDirectItems = async (items: CreatorImageImportItemInput[]) => {
    const rows = await stages.stageItems(items);
    const stageIds = rows.flatMap((row) => row.item.stageId ?? []);
    const invalid = rows.find((row) => row.state === 'INVALID');
    if (invalid) {
      await stages.discard(stageIds);
      throw new Error(`Invalid ${invalid.item.mimeType} image: ${invalid.item.name}`);
    }
    return { stageIds, duplicateCount: rows.filter((row) => row.state === 'DUPLICATE').length };
  };
  ipcMain.handle('creator:references-import', async (_event, raw) => {
    const input = imageImportSchema.parse(raw);
    const staged = await stageDirectItems(input.items);
    return stages.importReferences(input.context.source, staged.stageIds);
  });
  ipcMain.handle('creator:outputs-import', (_event, raw) => stages.import(stagedImageImportSchema.parse(raw)));
  ipcMain.handle('creator:new-external-creation-import', async (_event, raw) => {
    const input = newExternalCreationImportSchema.parse(raw);
    if (!input.outputs.length) return database.importNewExternalCreation(input);
    const staged = await stageDirectItems(input.outputs);
    return stages.importNewExternalCreation(input, staged.stageIds, staged.duplicateCount);
  });
  ipcMain.handle('creator:output-update', (_event, raw) =>
    database.updateImportedCreationOutput(outputUpdateSchema.parse(raw)),
  );
  ipcMain.handle('creator:outputs-stage', (_event, raw) => stages.stageItems(imageItemsSchema.parse(raw)));
  ipcMain.handle('creator:outputs-choose', async (_event, raw) => {
    imageChooseSchema.parse(raw);
    const result = await chooseImages();
    if (result.canceled || !result.filePaths.length) return null;
    return stages.stageFiles(result.filePaths);
  });
  ipcMain.handle('creator:outputs-discard', (_event, raw) => stages.discard(stageIdsSchema.parse(raw)));
}
