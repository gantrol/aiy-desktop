import { ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  videoSearchInputSchema,
  videoSearchResponseSchema,
  videoSearchOpenInputSchema,
  videoSearchOpenResultSchema,
} from '@/shared/contracts/video-search';
import { imageIssueInputSchema, imageIssueResultSchema } from '@/shared/contracts/image-search-issues';
import {
  imageSearchInputSchema,
  imageSearchItemSchema,
  imageSearchModelStateSchema,
  imageSearchRequestIdSchema,
  imageSearchResponseSchema,
  imageSearchDeviceSchema,
  contentSemanticInputSchema,
  contentSemanticResponseSchema,
  type ImageSearchApi,
} from '@/shared/contracts/image-search';

export const imageSearchApi: ImageSearchApi = {
  lookupVideo: async (input) =>
    videoSearchResponseSchema.parse(
      await ipcRenderer.invoke('image-search:video', videoSearchInputSchema.parse(input)),
    ),
  openVideo: async (input) =>
    videoSearchOpenResultSchema.parse(
      await ipcRenderer.invoke('image-search:video-open', videoSearchOpenInputSchema.parse(input)),
    ),
  issues: async (input) =>
    imageIssueResultSchema.parse(await ipcRenderer.invoke('image-search:issues', imageIssueInputSchema.parse(input))),
  modelState: async () => imageSearchModelStateSchema.parse(await ipcRenderer.invoke('image-search:model-state')),
  setDevice: async (device) => {
    await ipcRenderer.invoke('image-search:set-device', imageSearchDeviceSchema.parse(device));
  },
  downloadModel: async () => {
    await ipcRenderer.invoke('image-search:download-model');
  },
  cancelDownload: async () => {
    await ipcRenderer.invoke('image-search:cancel-download');
  },
  lookup: async (input) =>
    imageSearchResponseSchema.parse(
      await ipcRenderer.invoke('image-search:lookup', imageSearchInputSchema.parse(input)),
    ),
  lookupMetadata: async (input) =>
    imageSearchResponseSchema.parse(
      await ipcRenderer.invoke('image-search:metadata', imageSearchInputSchema.parse(input)),
    ),
  lookupContent: async (input) =>
    contentSemanticResponseSchema.parse(
      await ipcRenderer.invoke('image-search:content', contentSemanticInputSchema.parse(input)),
    ),
  cancel: async (requestId) => {
    await ipcRenderer.invoke('image-search:cancel', imageSearchRequestIdSchema.parse(requestId));
  },
  configure: async (locale) =>
    z.boolean().parse(await ipcRenderer.invoke('image-search:configure', z.enum(['en', 'zh']).parse(locale))),
  inspect: async (assetId) =>
    z.boolean().parse(await ipcRenderer.invoke('image-search:inspect', imageSearchItemSchema.shape.id.parse(assetId))),
};
