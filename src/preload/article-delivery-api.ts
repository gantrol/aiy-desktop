import type { IpcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  articleDeliveryArticleProfileSaveInputSchema,
  articleDeliveryArticleProfileSchema,
  articleDeliveryArticleTargetSchema,
  articleDeliveryConnectionDtoSchema,
  articleDeliveryConnectionSaveInputSchema,
  articleDeliveryExtensionTargetSchema,
  articleDeliveryJobChangedEventSchema,
  articleDeliveryJobListInputSchema,
  articleDeliveryJobRetryInputSchema,
  articleDeliveryJobSchema,
  articleDeliveryStatusSchema,
  articleDeliveryUploadInputSchema,
  articleDeliveryUploadResultSchema,
} from '@/shared/contracts/article-delivery';

type ArticleDeliveryPreloadApi = Pick<
  DesktopApi,
  | 'articleDeliveryConnectionGet'
  | 'articleDeliveryConnectionSave'
  | 'articleDeliveryConnectionTest'
  | 'articleDeliveryConnectionClear'
  | 'articleDeliveryStatus'
  | 'articleDeliveryArticleProfileSave'
  | 'articleDeliveryUpload'
  | 'articleDeliveryJobEnqueue'
  | 'articleDeliveryJobsList'
  | 'articleDeliveryJobRetry'
  | 'onArticleDeliveryJobChanged'
>;

export function createArticleDeliveryPreloadApi(ipcRenderer: IpcRenderer): ArticleDeliveryPreloadApi {
  return {
    articleDeliveryConnectionGet: async (input) =>
      articleDeliveryConnectionDtoSchema.parse(
        await ipcRenderer.invoke('article-delivery:connection-get', articleDeliveryExtensionTargetSchema.parse(input)),
      ),
    articleDeliveryConnectionSave: async (input) =>
      articleDeliveryConnectionDtoSchema.parse(
        await ipcRenderer.invoke(
          'article-delivery:connection-save',
          articleDeliveryConnectionSaveInputSchema.parse(input),
        ),
      ),
    articleDeliveryConnectionTest: async (input) =>
      articleDeliveryConnectionDtoSchema.parse(
        await ipcRenderer.invoke('article-delivery:connection-test', articleDeliveryExtensionTargetSchema.parse(input)),
      ),
    articleDeliveryConnectionClear: async (input) =>
      articleDeliveryConnectionDtoSchema.parse(
        await ipcRenderer.invoke(
          'article-delivery:connection-clear',
          articleDeliveryExtensionTargetSchema.parse(input),
        ),
      ),
    articleDeliveryStatus: async (input) =>
      articleDeliveryStatusSchema.parse(
        await ipcRenderer.invoke('article-delivery:status', articleDeliveryArticleTargetSchema.parse(input)),
      ),
    articleDeliveryArticleProfileSave: async (input) =>
      articleDeliveryArticleProfileSchema.parse(
        await ipcRenderer.invoke(
          'article-delivery:profile-save',
          articleDeliveryArticleProfileSaveInputSchema.parse(input),
        ),
      ),
    articleDeliveryUpload: async (input) =>
      articleDeliveryUploadResultSchema.parse(
        await ipcRenderer.invoke('article-delivery:upload', articleDeliveryUploadInputSchema.parse(input)),
      ),
    articleDeliveryJobEnqueue: async (input) =>
      articleDeliveryJobSchema.parse(
        await ipcRenderer.invoke('article-delivery:job-enqueue', articleDeliveryUploadInputSchema.parse(input)),
      ),
    articleDeliveryJobsList: async (input) =>
      articleDeliveryJobSchema
        .array()
        .max(50)
        .parse(await ipcRenderer.invoke('article-delivery:jobs-list', articleDeliveryJobListInputSchema.parse(input))),
    articleDeliveryJobRetry: async (input) =>
      articleDeliveryJobSchema.parse(
        await ipcRenderer.invoke('article-delivery:job-retry', articleDeliveryJobRetryInputSchema.parse(input)),
      ),
    onArticleDeliveryJobChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, rawEvent: unknown) => {
        callback(articleDeliveryJobChangedEventSchema.parse(rawEvent));
      };
      ipcRenderer.on('article-delivery:job-changed', listener);
      return () => ipcRenderer.off('article-delivery:job-changed', listener);
    },
  };
}
