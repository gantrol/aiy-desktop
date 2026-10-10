import { app, dialog } from 'electron';
import path from 'node:path';
import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  imageSearchInputSchema,
  imageSearchItemSchema,
  imageSearchRequestIdSchema,
  imageSearchDeviceSchema,
  contentSemanticInputSchema,
} from '@/shared/contracts/image-search';
import {
  readImageSearchConfiguration,
  resolveImageSearchRuntime,
  saveImageSearchDevice,
  saveImageSearchModel,
} from '@/main/image-search/runtime';
import { ImageSearchModelDownload } from '@/main/image-search/model-download';
import { resolveOnnxRuntime } from '@/main/image-search/native-runtime';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import { localeSchema } from '@/main/ipc/schemas';
import { imageSearchMessages } from '@/shared/i18n/image-search';
import { IMAGE_SEARCH_EXTENSION_ID } from '@/shared/extension-ids';
import { imageIssueInputSchema } from '@/shared/contracts/image-search-issues';
import { videoSearchInputSchema, videoSearchOpenInputSchema } from '@/shared/contracts/video-search';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';

const downloads = new Map<string, ImageSearchModelDownload>();

/** Host adapter for the packaged capability; no paths or arbitrary download URLs cross renderer IPC. */
export function registerImageSearchIpc(
  ipc: IpcHandlerRegistrar,
  database: LibraryDatabase,
  extensions: ExtensionRegistry,
) {
  const userData = app.getPath('userData');
  const configurationPath = path.join(userData, 'image-search-runtime.json');
  let downloader = downloads.get(userData);
  if (!downloader) {
    downloader = new ImageSearchModelDownload(userData);
    downloads.set(userData, downloader);
  }
  const modelDownload = downloader;
  const active = () => extensions.isActivated(IMAGE_SEARCH_EXTENSION_ID);
  const videoActive = (selected = false) =>
    active() &&
    (extensions.isPermissionGranted(IMAGE_SEARCH_EXTENSION_ID, EXTENSION_PERMISSION.libraryReadActiveVideos) ||
      (selected &&
        extensions.isPermissionGranted(IMAGE_SEARCH_EXTENSION_ID, EXTENSION_PERMISSION.libraryReadSelectedVideos)));
  ipc.handle('image-search:video', (_event, raw) => {
    const input = videoSearchInputSchema.parse(raw);
    return videoActive(Boolean(input.documentIds))
      ? database.videoSearch.lookup(input, configurationPath)
      : { error: 'DISABLED' };
  });
  ipc.handle('image-search:video-open', (_event, raw) => {
    const input = videoSearchOpenInputSchema.parse(raw);
    return videoActive(true) ? database.videoSearch.open(input) : null;
  });
  ipc.handle('image-search:issues', (_event, raw) =>
    database.imageMetadataSearch.issues(imageIssueInputSchema.parse(raw)),
  );
  let downloadPermissions: string[] = [];
  const hasPermissions = (permissions: string[]) =>
    active() &&
    permissions.every((permission) => extensions.isPermissionGranted(IMAGE_SEARCH_EXTENSION_ID, permission));
  const downloadPlan = async () => {
    const modelReady = await resolveImageSearchRuntime(configurationPath, true, false).then(
      () => true,
      () => false,
    );
    const runtimeRequired = await resolveOnnxRuntime(userData).then(
      () => false,
      () => true,
    );
    const permissions = [
      ...(!modelReady ? ['network:https://huggingface.co'] : []),
      ...(runtimeRequired ? ['network:https://unpkg.com'] : []),
    ];
    return { modelReady, runtimeRequired, permissions };
  };
  extensions.onChanged(() => {
    if (!videoActive()) database.videoSearch.stop();
    if (!active()) {
      database.imageSearch.stop();
      database.contentSemanticSearch.stop();
    }
    if (!hasPermissions(downloadPermissions)) modelDownload.cancel();
  });
  ipc.handle('image-search:lookup', async (_event, raw) => {
    const input = imageSearchInputSchema.parse(raw);
    if (input.mode !== 'HYBRID')
      return active() ? database.imageSearch.lookup(input, configurationPath) : { error: 'DISABLED' };
    // Keyword/OCR remains available when the optional semantic capability cannot run.
    const keywords = await database.imageMetadataSearch.lookup(input);
    if ('error' in keywords) return keywords;
    const semantic = active()
      ? await database.imageSearch.lookup(input, configurationPath)
      : { error: 'DISABLED' as const };
    if (
      'error' in semantic &&
      ['DISABLED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'GPU_UNAVAILABLE'].includes(semantic.error)
    )
      return { result: { ...keywords.result, warning: semantic.error } };
    return semantic;
  });
  ipc.handle('image-search:metadata', (_event, raw) =>
    database.imageMetadataSearch.lookup(imageSearchInputSchema.parse(raw)),
  );
  ipc.handle('image-search:content', (_event, raw) => {
    const input = contentSemanticInputSchema.parse(raw);
    return active()
      ? database.contentSemanticSearch.lookup(input, configurationPath)
      : input.mode === 'HYBRID'
        ? database.contentSemanticSearch.lookupKeywords(input, 'DISABLED')
        : { error: 'DISABLED' };
  });
  ipc.handle('image-search:cancel', (_event, raw) => {
    const id = imageSearchRequestIdSchema.parse(raw);
    database.imageSearch.cancel(id);
    database.imageMetadataSearch.cancel(id);
    database.contentSemanticSearch.cancel(id);
    database.videoSearch.cancel(id);
  });
  ipc.handle('image-search:inspect', (_event, raw) =>
    database.imageSearch.inspect(imageSearchItemSchema.shape.id.parse(raw)),
  );
  ipc.handle('image-search:model-state', async () => {
    const plan = await downloadPlan();
    return {
      active: active(),
      ready: plan.modelReady && !plan.runtimeRequired,
      modelReady: plan.modelReady,
      runtimeRequired: plan.runtimeRequired,
      canDownload: hasPermissions(plan.permissions),
      ...modelDownload.state,
      device: await readImageSearchConfiguration(configurationPath).then(
        (configuration) => configuration.device,
        () => 'AUTO',
      ),
      execution: {
        ...database.imageSearch.execution,
        content: database.contentSemanticSearch.execution,
        video: database.videoSearch.execution,
      },
    };
  });
  ipc.handle('image-search:set-device', async (_event, raw) => {
    if (!active()) throw new Error('DISABLED');
    const device = imageSearchDeviceSchema.parse(raw);
    await saveImageSearchDevice(configurationPath, device);
    database.imageSearch.stop();
    database.contentSemanticSearch.stop();
    database.videoSearch.stop();
  });
  ipc.handle('image-search:download-model', async () => {
    const plan = await downloadPlan();
    if (!hasPermissions(plan.permissions)) throw new Error('IMAGE_SEARCH_DOWNLOAD_PERMISSION_REQUIRED');
    if (modelDownload.state.download === 'DOWNLOADING') return;
    downloadPermissions = plan.permissions;
    modelDownload.start(plan);
  });
  ipc.handle('image-search:cancel-download', () => modelDownload.cancel());
  let configuring = false;
  ipc.handle('image-search:configure', async (_event, rawLocale) => {
    if (!active() || configuring || modelDownload.state.download === 'DOWNLOADING') return false;
    const locale = localeSchema.parse(rawLocale);
    const catalog = extensions.listLanguagePacks().find((pack) => pack.locale === locale)?.messages.imageSearch;
    const copy = catalog && typeof catalog === 'object' ? (catalog as Record<string, unknown>) : {};
    configuring = true;
    try {
      const selection = await dialog.showOpenDialog({
        title: typeof copy.model === 'string' ? copy.model : imageSearchMessages.model,
        properties: ['openDirectory'],
      });
      if (!active() || selection.canceled || !selection.filePaths[0]) return false;
      await saveImageSearchModel(configurationPath, selection.filePaths[0]);
      database.imageSearch.stop();
      database.contentSemanticSearch.stop();
      database.videoSearch.stop();
      return true;
    } finally {
      configuring = false;
    }
  });
}
