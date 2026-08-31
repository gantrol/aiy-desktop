import { app, shell, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import type { CodexVisualizationDiscovery } from '@/main/extensions/codex-visualization-discovery';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  codexVisualizationArtifactActionInputSchema,
  codexVisualizationHtmlPreviewReleaseInputSchema,
  codexVisualizationListInputSchema,
  codexVisualizationSessionActionInputSchema,
} from '@/shared/contracts/codex-visualizations';
import {
  CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID,
  CODEX_VISUALIZATION_THREAD_CONTENT_PERMISSION,
} from '@/shared/extension-ids';

export function registerCodexVisualizationIpc(
  ipcMain: IpcHandlerRegistrar,
  extensions: ExtensionRegistry,
  discovery: CodexVisualizationDiscovery,
  chooseDirectory: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>,
  chooseSaveFile: (options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>,
) {
  const active = () => {
    if (!extensions.isActivated(CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID)) {
      throw new Error('Codex Visualizations is disabled or missing permissions');
    }
  };
  const invoke = async <T>(operation: () => T | Promise<T>) => {
    active();
    return await operation();
  };
  const threadContentAuthorized = () =>
    extensions.isPermissionGranted(
      CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID,
      CODEX_VISUALIZATION_THREAD_CONTENT_PERMISSION,
    );
  const requireThreadContentPermission = () => {
    if (!threadContentAuthorized()) {
      throw new Error('Reading Codex task content requires optional permission');
    }
  };
  ipcMain.handle('codex-visualizations:list', (_event, raw) =>
    invoke(async () => {
      const input = codexVisualizationListInputSchema.parse(raw);
      if (input.threadDiagramDateRange) requireThreadContentPermission();
      const result = await discovery.list(input);
      if (input.threadDiagramDateRange) requireThreadContentPermission();
      return result;
    }),
  );
  ipcMain.handle('codex-visualization:open', (_event, raw) =>
    invoke(async () => {
      const input = codexVisualizationArtifactActionInputSchema.parse(raw);
      const filePath = await discovery.resolveArtifactFile(input.artifactId);
      const message = await shell.openPath(filePath);
      if (message) throw new Error(message);
    }),
  );
  ipcMain.handle('codex-visualization:prepare-html-preview', (_event, raw) =>
    invoke(() => {
      const input = codexVisualizationArtifactActionInputSchema.parse(raw);
      return discovery.prepareHtmlPreview(input.artifactId);
    }),
  );
  ipcMain.handle('codex-visualization:prepare-mermaid-preview', (_event, raw) =>
    invoke(async () => {
      const input = codexVisualizationArtifactActionInputSchema.parse(raw);
      const usesThreadContent = discovery.artifactUsesThreadContent(input.artifactId);
      if (usesThreadContent) requireThreadContentPermission();
      const result = await discovery.prepareMermaidPreview(input.artifactId);
      if (usesThreadContent) requireThreadContentPermission();
      return result;
    }),
  );
  ipcMain.handle('codex-visualization:release-html-preview', (_event, raw) =>
    invoke(() => {
      const input = codexVisualizationHtmlPreviewReleaseInputSchema.parse(raw);
      discovery.releaseHtmlPreview(input.previewId);
    }),
  );
  ipcMain.handle('codex-visualization:reveal', (_event, raw) =>
    invoke(async () => {
      const input = codexVisualizationArtifactActionInputSchema.parse(raw);
      shell.showItemInFolder(await discovery.resolveArtifactFile(input.artifactId));
    }),
  );
  ipcMain.handle('codex-visualization:export', (_event, raw) =>
    invoke(async () => {
      const input = codexVisualizationArtifactActionInputSchema.parse(raw);
      if (discovery.artifactUsesThreadContent(input.artifactId)) requireThreadContentPermission();
      const selection = await chooseSaveFile({ defaultPath: discovery.artifactExportName(input.artifactId) });
      if (selection.canceled || !selection.filePath) {
        return { canceled: true, exportedFileCount: 0, destinationPath: null };
      }
      await discovery.exportArtifact(input.artifactId, selection.filePath);
      return { canceled: false, exportedFileCount: 1, destinationPath: selection.filePath };
    }),
  );
  ipcMain.handle('codex-visualization:export-session', (_event, raw) =>
    invoke(async () => {
      const input = codexVisualizationSessionActionInputSchema.parse(raw);
      if (discovery.sessionUsesThreadContent(input.sessionId)) requireThreadContentPermission();
      discovery.sessionExportName(input.sessionId);
      const selection = await chooseDirectory({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: app.getPath('downloads'),
      });
      const destinationRoot = selection.filePaths[0];
      if (selection.canceled || !destinationRoot) {
        return { canceled: true, exportedFileCount: 0, destinationPath: null };
      }
      const result = await discovery.exportSession(input.sessionId, destinationRoot);
      return { canceled: false, ...result };
    }),
  );
}
