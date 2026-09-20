import type { NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import { z } from 'zod';
import { ArticleDeliveryConnections } from '@/main/extensions/article-delivery/connection';
import type { ArticleDeliveryJobCoordinator } from '@/main/extensions/article-delivery/job-coordinator';
import {
  assertArticleDeliveryExtensionActivated,
  resolveArticleDeliveryDefinition,
} from '@/main/extensions/article-delivery/definition';
import { ArticleDeliveryService } from '@/main/extensions/article-delivery/service';
import { waitForUploadPreparation } from '@/main/extensions/article-delivery/upload-lifecycle';
import type { LibraryDatabase } from '@/main/database';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  articleDeliveryArticleProfileSaveInputSchema,
  articleDeliveryArticleProfileSchema,
  articleDeliveryArticleTargetSchema,
  articleDeliveryConnectionDtoSchema,
  articleDeliveryConnectionSaveInputSchema,
  articleDeliveryExtensionTargetSchema,
  articleDeliveryJobListInputSchema,
  articleDeliveryJobRetryInputSchema,
  articleDeliveryJobSchema,
  articleDeliveryJobEnqueueInvocationSchema,
  articleDeliveryStatusSchema,
  articleDeliveryUploadInputSchema,
  articleDeliveryUploadResultSchema,
  type ArticleDeliveryExtensionTarget,
} from '@/shared/contracts/article-delivery';

const legacyArticleDeliveryUploadInputSchema = articleDeliveryArticleTargetSchema
  .extend({
    // One development preload build emitted a lowercase `l` in place of the `I` in `Id`.
    expectedRevisionld: z.unknown(),
  })
  .strict();

function parseArticleDeliveryUploadInput(rawInput: unknown) {
  const current = articleDeliveryUploadInputSchema.safeParse(rawInput);
  if (current.success) return current.data;

  const legacy = legacyArticleDeliveryUploadInputSchema.safeParse(rawInput);
  if (!legacy.success) throw current.error;
  const { expectedRevisionld, ...target } = legacy.data;
  return articleDeliveryUploadInputSchema.parse({ ...target, expectedRevisionId: expectedRevisionld });
}

export function registerArticleDeliveryIpc(
  ipcMain: IpcHandlerRegistrar,
  database: LibraryDatabase,
  extensions: ExtensionRegistry,
  connections: ArticleDeliveryConnections,
  jobs: ArticleDeliveryJobCoordinator,
  naturalWatermark?: NaturalWatermarkRuntime,
) {
  // Capture callable methods, not authorization results: later checks must still
  // observe revocation, while class methods retain their original receiver.
  const captureExtensions = () => ({
    get: extensions.get.bind(extensions),
    isActivated: extensions.isActivated.bind(extensions),
    isPermissionGranted: extensions.isPermissionGranted.bind(extensions),
  });
  const captureDatabase = () => ({
    libraryRoot: database.libraryRoot,
    getArticle: database.getArticle.bind(database),
    getArticleRevision: database.getArticleRevision.bind(database),
    contentLibrary: database.contentLibrary,
    resolveAssetFilesAsync: database.resolveAssetFilesAsync.bind(database),
  });
  const context = async (
    target: ArticleDeliveryExtensionTarget,
    capturedExtensions: ReturnType<typeof captureExtensions>,
  ) => {
    const definition = resolveArticleDeliveryDefinition(capturedExtensions, target);
    const connection = await connections.get(target.extensionId);
    return { definition, connection };
  };
  const active = (target: ArticleDeliveryExtensionTarget, capturedExtensions: ReturnType<typeof captureExtensions>) => {
    assertArticleDeliveryExtensionActivated(capturedExtensions, target.extensionId);
  };
  const assertSpace = (spaceId: string) => {
    if (database.getLocalSpace().id !== spaceId) {
      throw Object.assign(new Error('DELIVERY_SPACE_CHANGED'), {
        code: 'DELIVERY_SPACE_CHANGED',
        admissionRejected: true,
      });
    }
  };

  ipcMain.handle('article-delivery:connection-get', async (_event, rawInput) => {
    const target = articleDeliveryExtensionTargetSchema.parse(rawInput);
    const { definition, connection } = await context(target, captureExtensions());
    return articleDeliveryConnectionDtoSchema.parse(connection.status(definition));
  });
  ipcMain.handle('article-delivery:connection-save', async (_event, rawInput) => {
    const input = articleDeliveryConnectionSaveInputSchema.parse(rawInput);
    const capturedExtensions = captureExtensions();
    active(input, capturedExtensions);
    const { definition, connection } = await context(input, capturedExtensions);
    return articleDeliveryConnectionDtoSchema.parse(
      await connection.saveAndTest(definition, input, () => active(input, capturedExtensions)),
    );
  });
  ipcMain.handle('article-delivery:connection-test', async (_event, rawInput) => {
    const target = articleDeliveryExtensionTargetSchema.parse(rawInput);
    const capturedExtensions = captureExtensions();
    active(target, capturedExtensions);
    const { definition, connection } = await context(target, captureExtensions());
    return articleDeliveryConnectionDtoSchema.parse(
      await connection.test(definition, () => active(target, capturedExtensions)),
    );
  });
  ipcMain.handle('article-delivery:connection-clear', async (_event, rawInput) => {
    const target = articleDeliveryExtensionTargetSchema.parse(rawInput);
    const { definition, connection } = await context(target, captureExtensions());
    return articleDeliveryConnectionDtoSchema.parse(await connection.clear(definition));
  });
  ipcMain.handle('article-delivery:status', async (_event, rawInput) => {
    const input = articleDeliveryArticleTargetSchema.parse(rawInput);
    assertSpace(input.spaceId);
    const capturedExtensions = captureExtensions();
    const capturedDatabase = captureDatabase();
    const { definition, connection } = await context(input, capturedExtensions);
    const delivery = new ArticleDeliveryService(
      capturedDatabase,
      capturedExtensions,
      connection,
      definition,
      undefined,
      naturalWatermark,
    );
    return articleDeliveryStatusSchema.parse(delivery.status(input));
  });
  ipcMain.handle('article-delivery:profile-save', async (_event, rawInput) => {
    const input = articleDeliveryArticleProfileSaveInputSchema.parse(rawInput);
    assertSpace(input.spaceId);
    const capturedExtensions = captureExtensions();
    const capturedDatabase = captureDatabase();
    active(input, capturedExtensions);
    const { definition, connection } = await context(input, capturedExtensions);
    const delivery = new ArticleDeliveryService(
      capturedDatabase,
      capturedExtensions,
      connection,
      definition,
      undefined,
      naturalWatermark,
    );
    return articleDeliveryArticleProfileSchema.parse(await delivery.saveProfile(input));
  });
  ipcMain.handle('article-delivery:upload', async (_event, rawInput) => {
    const input = parseArticleDeliveryUploadInput(rawInput);
    assertSpace(input.spaceId);
    // Capture this context before connection loading yields to a possible library switch.
    const upload = jobs.acquireUpload();
    try {
      const capturedExtensions = captureExtensions();
      const capturedDatabase = captureDatabase();
      const { definition, connection } = await waitForUploadPreparation(
        context(input, capturedExtensions),
        upload.signal,
      );
      const delivery = new ArticleDeliveryService(
        capturedDatabase,
        capturedExtensions,
        connection,
        definition,
        undefined,
        naturalWatermark,
      );
      return articleDeliveryUploadResultSchema.parse(await delivery.upload(input, upload.signal));
    } finally {
      upload.release();
    }
  });
  ipcMain.handle('article-delivery:job-enqueue', async (_event, rawInput) => {
    const input = parseArticleDeliveryUploadInput(rawInput);
    try {
      assertSpace(input.spaceId);
      return articleDeliveryJobSchema.parse(await jobs.enqueue(input));
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'admissionRejected' in reason && reason.admissionRejected === true) {
        return articleDeliveryJobEnqueueInvocationSchema.parse({
          admissionRejected: true,
          errorCode: 'code' in reason && typeof reason.code === 'string' ? reason.code : 'DELIVERY_ADMISSION_REJECTED',
        });
      }
      throw reason;
    }
  });
  ipcMain.handle('article-delivery:jobs-list', (_event, rawInput) => {
    const input = articleDeliveryJobListInputSchema.parse(rawInput);
    return articleDeliveryJobSchema.array().max(50).parse(jobs.list(input));
  });
  ipcMain.handle('article-delivery:job-retry', (_event, rawInput) => {
    const input = articleDeliveryJobRetryInputSchema.parse(rawInput);
    return articleDeliveryJobSchema.parse(jobs.retry(input));
  });
}
