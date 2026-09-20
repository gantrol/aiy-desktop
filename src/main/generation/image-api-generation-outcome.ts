import type { LibraryDatabase } from '@/main/database';
import type { CpaImageConnection } from '@/main/extensions/cpa-image/connection';
import { refreshCpaImageConnection } from '@/main/extensions/cpa-image/integration';
import type { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import type { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import {
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  CPA_IMAGE_PROVIDER_KEY,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  OPENAI_IMAGE_PROVIDER_KEY,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
  type ExternalImageApiExtensionId,
} from '@/shared/extension-ids';

const imageApiExtensionByProvider: Partial<Record<string, ExternalImageApiExtensionId>> = {
  google: GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  'alibaba-cloud': ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  volcengine: VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
};

interface Options {
  database: LibraryDatabase;
  openAiImageApi: OpenAiImageApiConnection;
  cpaImageApi: CpaImageConnection;
  externalImageApis: ExternalImageApiConnections;
  refreshOpenAi(): void;
  refreshExternal(): Promise<unknown>;
}

export function recordImageApiGenerationOutcome(runId: string, options: Options) {
  const { database, openAiImageApi, cpaImageApi, externalImageApis, refreshOpenAi, refreshExternal } = options;
  try {
    const job = database.getGenerationJob(runId);
    const modelProviderKey = database.getGenerationRunModelKey(runId)?.split('/')[0];
    const providerKey = job?.providerKey || modelProviderKey;
    const extensionId = providerKey ? imageApiExtensionByProvider[providerKey] : undefined;
    if (providerKey === OPENAI_IMAGE_PROVIDER_KEY && job?.status === 'SUCCEEDED') {
      openAiImageApi.markVerified(job.providerRequestId);
      refreshOpenAi();
    } else if (providerKey === OPENAI_IMAGE_PROVIDER_KEY && job?.errorCode === 'AUTH') {
      openAiImageApi.markConnectionError(job.errorMessage || 'OpenAI rejected the API credentials');
      refreshOpenAi();
    } else if (providerKey === CPA_IMAGE_PROVIDER_KEY && (job?.status === 'SUCCEEDED' || job?.errorCode === 'AUTH')) {
      refreshCpaImageConnection(cpaImageApi, job.status === 'SUCCEEDED', refreshExternal);
    } else if (job?.status === 'SUCCEEDED' && extensionId) {
      externalImageApis.markVerified(extensionId, job.providerRequestId);
      void refreshExternal().catch((error) =>
        console.error('[external-image-api] failed to refresh worker verification', error),
      );
    } else if (job?.errorCode === 'AUTH' && extensionId) {
      externalImageApis.markConnectionError(extensionId, job.errorMessage || 'Provider rejected the API credentials');
      void refreshExternal().catch((error) =>
        console.error('[external-image-api] failed to refresh worker verification', error),
      );
    }
  } catch (error) {
    console.error('[image-api] failed to persist connection state', error);
  }
}
