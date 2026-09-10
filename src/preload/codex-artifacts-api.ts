import type { DesktopApi } from '@/shared/contracts';
import {
  codexHistoryFilterOptionsInputSchema,
  codexHistoryFilterOptionsSchema,
  codexHistoryIndexStateSchema,
  codexHistoryRefreshInputSchema,
  codexHistorySearchInputSchema,
  codexHistorySearchPageSchema,
  codexHistoryThreadUsageInputSchema,
  codexHistoryThreadUsageSchema,
  codexHistoryThreadMessagesInputSchema,
  codexHistoryThreadMessagesPageSchema,
} from '@/shared/contracts/codex-history-search';
import {
  codexVisualizationArtifactActionInputSchema,
  codexVisualizationExportResultSchema,
  codexVisualizationHtmlPreviewReleaseInputSchema,
  codexVisualizationHtmlPreviewSchema,
  codexVisualizationListInputSchema,
  codexVisualizationMermaidPreviewSchema,
  codexVisualizationSessionActionInputSchema,
  codexVisualizationSnapshotSchema,
} from '@/shared/contracts/codex-visualizations';

type CodexArtifactsPreloadApi = Pick<
  DesktopApi,
  | 'codexGeneratedImagesList'
  | 'codexGeneratedImagesImport'
  | 'codexGeneratedImagesRecover'
  | 'codexHistorySearchState'
  | 'codexHistorySearch'
  | 'codexHistorySearchFilterOptions'
  | 'codexHistorySearchRefresh'
  | 'codexHistoryThreadUsageCancel'
  | 'codexHistoryThreadUsage'
  | 'codexHistoryThreadMessages'
  | 'onCodexHistorySearchChanged'
  | 'codexVisualizationsList'
  | 'codexVisualizationOpen'
  | 'codexVisualizationPrepareHtmlPreview'
  | 'codexVisualizationPrepareMermaidPreview'
  | 'codexVisualizationReleaseHtmlPreview'
  | 'codexVisualizationReveal'
  | 'codexVisualizationExport'
  | 'codexVisualizationExportSession'
  | 'onCodexVisualizationsChanged'
>;

export function createCodexArtifactsPreloadApi(
  ipcRenderer: Pick<Electron.IpcRenderer, 'invoke' | 'on' | 'removeListener'>,
): CodexArtifactsPreloadApi {
  return {
    codexGeneratedImagesList: (input) => ipcRenderer.invoke('codex-generated-images:list', input),
    codexGeneratedImagesImport: (input) => ipcRenderer.invoke('codex-generated-images:import', input),
    codexGeneratedImagesRecover: (input) => ipcRenderer.invoke('codex-generated-images:recover', input),
    codexHistorySearchState: async () =>
      codexHistoryIndexStateSchema.parse(await ipcRenderer.invoke('codex-history-search:state')),
    codexHistorySearch: async (input) =>
      codexHistorySearchPageSchema.parse(
        await ipcRenderer.invoke('codex-history-search:query', codexHistorySearchInputSchema.parse(input)),
      ),
    codexHistorySearchFilterOptions: async (input) =>
      codexHistoryFilterOptionsSchema.parse(
        await ipcRenderer.invoke(
          'codex-history-search:filter-options',
          codexHistoryFilterOptionsInputSchema.parse(input),
        ),
      ),
    codexHistorySearchRefresh: async (input) =>
      codexHistoryIndexStateSchema.parse(
        await ipcRenderer.invoke('codex-history-search:refresh', codexHistoryRefreshInputSchema.parse(input)),
      ),
    codexHistoryThreadUsageCancel: (input) =>
      ipcRenderer.invoke('codex-history-search:cancel-thread-usage', codexHistoryThreadUsageInputSchema.parse(input)),
    codexHistoryThreadUsage: async (input) =>
      codexHistoryThreadUsageSchema
        .nullable()
        .parse(
          await ipcRenderer.invoke(
            'codex-history-search:thread-usage',
            codexHistoryThreadUsageInputSchema.parse(input),
          ),
        ),
    codexHistoryThreadMessages: async (input) =>
      codexHistoryThreadMessagesPageSchema.parse(
        await ipcRenderer.invoke(
          'codex-history-search:thread-messages',
          codexHistoryThreadMessagesInputSchema.parse(input),
        ),
      ),
    onCodexHistorySearchChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('codex-history-search:changed', listener);
      return () => ipcRenderer.removeListener('codex-history-search:changed', listener);
    },
    codexVisualizationsList: async (input) =>
      codexVisualizationSnapshotSchema.parse(
        await ipcRenderer.invoke('codex-visualizations:list', codexVisualizationListInputSchema.parse(input)),
      ),
    codexVisualizationOpen: (input) =>
      ipcRenderer.invoke('codex-visualization:open', codexVisualizationArtifactActionInputSchema.parse(input)),
    codexVisualizationPrepareHtmlPreview: async (input) =>
      codexVisualizationHtmlPreviewSchema.parse(
        await ipcRenderer.invoke(
          'codex-visualization:prepare-html-preview',
          codexVisualizationArtifactActionInputSchema.parse(input),
        ),
      ),
    codexVisualizationPrepareMermaidPreview: async (input) =>
      codexVisualizationMermaidPreviewSchema.parse(
        await ipcRenderer.invoke(
          'codex-visualization:prepare-mermaid-preview',
          codexVisualizationArtifactActionInputSchema.parse(input),
        ),
      ),
    codexVisualizationReleaseHtmlPreview: (input) =>
      ipcRenderer.invoke(
        'codex-visualization:release-html-preview',
        codexVisualizationHtmlPreviewReleaseInputSchema.parse(input),
      ),
    codexVisualizationReveal: (input) =>
      ipcRenderer.invoke('codex-visualization:reveal', codexVisualizationArtifactActionInputSchema.parse(input)),
    codexVisualizationExport: async (input) =>
      codexVisualizationExportResultSchema.parse(
        await ipcRenderer.invoke(
          'codex-visualization:export',
          codexVisualizationArtifactActionInputSchema.parse(input),
        ),
      ),
    codexVisualizationExportSession: async (input) =>
      codexVisualizationExportResultSchema.parse(
        await ipcRenderer.invoke(
          'codex-visualization:export-session',
          codexVisualizationSessionActionInputSchema.parse(input),
        ),
      ),
    onCodexVisualizationsChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('codex-visualizations:changed', listener);
      return () => ipcRenderer.removeListener('codex-visualizations:changed', listener);
    },
  };
}
