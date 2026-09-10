import { EventEmitter } from 'node:events';
import { sha256HexAsync } from '@/main/database/core/storage';
import { homedir } from 'node:os';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { shell } from 'electron';
import type { LibraryDatabase } from '@/main/database';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import { CodexAppServerClient } from '@/main/extensions/codex-app-server/client';
import { readCodexSidebarState } from '@/main/extensions/codex-history-search/sidebar-state-reader';
import { CodexContentRepository, type OutputRequest } from '@/main/extensions/codex-content/repository';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import { codexThreadHref } from '@/shared/contracts/codex-thread';
import type {
  CodexContentExecution,
  CodexContentState,
  CodexContentTask,
  CodexProjectTarget,
} from '@/shared/contracts/codex-content';
import { contentAssetPath } from '@/shared/content-document';
import { contentMarkdownMediaPaths, replaceMarkdownMedia } from '@/shared/content-markdown';
import { validatePngFileAsync } from '@/main/media/png-validation';
import { mediaUrl } from '@/main/database/core/values';
import type { CodexService } from '@/main/assistant/codex-service';
import { CodexPetalQuota } from '@/main/extensions/codex-content/quota';
import { resolveNoteFile } from '@/main/desktop-petals/note-file-store';
import type { NoteFile } from '@/shared/contracts/note-files';

const executionPermissions = [
  EXTENSION_PERMISSION.integrationConnectCodexAppServer,
  EXTENSION_PERMISSION.codexManageExtensionThreads,
  EXTENSION_PERMISSION.libraryReadSelectedReferences,
  EXTENSION_PERMISSION.libraryReadSelectedContent,
  EXTENSION_PERMISSION.libraryCreateCreations,
];
const error = (code: string) => new Error(`[aiy-codex-content:${code}]`);
interface ActiveTask {
  controller: AbortController;
  completion: Promise<void>;
  client: CodexAppServerClient;
  cancel?: () => void;
  workingItems: Set<string>;
}
interface TaskInput {
  text: string;
  referenceAssetIds: string[];
  attachments: NoteFile[];
}

/** Codex owns execution, project resolution and receipts; flower windows only consume this capability. */
export class CodexContentService extends EventEmitter {
  readonly repository: CodexContentRepository;
  readonly quota: CodexPetalQuota;
  private readonly active = new Map<string, ActiveTask>();
  private readonly collections = new Map<string, { controller: AbortController; completion: Promise<void> }>();
  private projectCache: { until: number; value: Promise<CodexProjectTarget[]> } | null = null;
  private accepting = true;
  private readonly unsubscribeExtensions: () => void;
  constructor(
    private readonly database: LibraryDatabase,
    private readonly extensions: ExtensionRegistry,
    private readonly codex: CodexService,
  ) {
    super();
    this.repository = new CodexContentRepository(database);
    this.quota = new CodexPetalQuota(codex, extensions);
    this.repository.recover();
    this.unsubscribeExtensions = extensions.onChanged(() => {
      this.projectCache = null;
      if (
        !this.enabled ||
        executionPermissions.some((permission) => !this.extensions.isPermissionGranted(CODEX_EXTENSION_ID, permission))
      ) {
        for (const active of this.active.values()) {
          active.controller.abort();
          active.cancel?.();
          void active.client.dispose().catch(() => undefined);
        }
        for (const collection of this.collections.values()) collection.controller.abort();
      }
      this.emit('changed');
    });
  }
  get enabled() {
    return this.extensions.isActivated(CODEX_EXTENSION_ID);
  }
  private require(...permissions: string[]) {
    if (
      !this.accepting ||
      !this.enabled ||
      permissions.some((permission) => !this.extensions.isPermissionGranted(CODEX_EXTENSION_ID, permission))
    )
      throw error('permission');
  }
  private source(stashId: string) {
    const stash = this.database.getInspirationStash(stashId);
    if (stash.status !== 'ACTIVE') throw error('source');
    return stash;
  }
  state(stashId: string): CodexContentState {
    this.require(EXTENSION_PERMISSION.libraryReadSelectedContent);
    this.source(stashId);
    const latest = this.repository.latest(stashId);
    return {
      enabled: this.enabled,
      project: this.selectedProject(stashId, latest),
      albumId: this.repository.albumId(),
      execution: this.repository.execution(stashId),
      tasks: (latest ? [latest] : []).map((task) => ({
        ...task,
        activity:
          task.status === 'RUNNING' ? (this.active.get(task.id)?.workingItems.size ? 'working' : 'thinking') : null,
      })),
    };
  }
  private selectedProject(stashId: string, latest = this.repository.latest(stashId)) {
    return this.repository.project(stashId) ?? latest?.project ?? this.repository.lastProject();
  }
  async models() {
    this.require(EXTENSION_PERMISSION.integrationConnectCodexAppServer);
    return this.codex.listModels();
  }
  private async validateExecution(execution: CodexContentExecution) {
    if (!execution.model) {
      if (execution.effort) throw error('model');
      return execution;
    }
    const model = (await this.models()).find((item) => item.key === execution.model);
    if (!model || (execution.effort && !model.supportedReasoningEfforts.includes(execution.effort)))
      throw error('model');
    return { model: model.key, effort: execution.effort ?? model.defaultReasoningEffort };
  }
  async selectExecution(stashId: string, execution: CodexContentExecution) {
    this.require();
    this.source(stashId);
    await this.validateExecution(execution);
    this.require();
    this.source(stashId);
    if (this.repository.hasActive(stashId)) throw error('busy');
    this.repository.selectExecution(stashId, execution);
    this.emit('changed');
    return this.state(stashId);
  }
  async projects(fresh = false) {
    this.require(EXTENSION_PERMISSION.filesystemReadCodexSessionMetadata);
    if (!fresh && this.projectCache && this.projectCache.until > Date.now()) return this.projectCache.value;
    const globalStatePath = path.join(
      process.env.CODEX_HOME || path.join(homedir(), '.codex'),
      '.codex-global-state.json',
    );
    if (/trash/i.test(globalStatePath)) throw error('project');
    const value = readCodexSidebarState(globalStatePath, AbortSignal.timeout(5000))
      .then((state) => {
        const targets = new Map<string, CodexProjectTarget>();
        for (const project of state?.projects ?? []) {
          const roots = new Map<string, string>();
          for (const root of project.rootPaths) {
            if (!path.isAbsolute(root) || /trash/i.test(root)) continue;
            const workspace = path.resolve(root);
            roots.set(process.platform === 'win32' ? workspace.toLowerCase() : workspace, workspace);
          }
          const rootPaths = [...roots.values()];
          // Identity belongs to the project. Directories are its execution scope.
          targets.set(project.projectId, {
            projectId: project.projectId,
            name: project.name,
            workspace: rootPaths[0] ?? '',
            rootPaths,
          });
        }
        return [...targets.values()];
      })
      .catch(() => {
        this.projectCache = null;
        throw error('project');
      });
    this.projectCache = { until: Date.now() + 30000, value };
    return value;
  }
  private async resolveProject(selected: CodexProjectTarget, fresh = false) {
    if (!selected.projectId)
      return {
        projectId: null,
        name: '',
        workspace: path.join(this.database.libraryRoot, 'codex-workspace'),
        rootPaths: [],
      };
    const project = (await this.projects(fresh)).find((item) => item.projectId === selected.projectId);
    if (!project) throw error('project');
    const roots: string[] = [];
    // At most 100 configured roots; avoid an unbounded metadata fan-out.
    for (const root of project.rootPaths ?? []) {
      const info = await lstat(root).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink()) throw error('project');
      const resolved = await realpath(root);
      if (/trash/i.test(resolved)) throw error('project');
      roots.push(resolved);
    }
    const workspace =
      roots[0] ??
      path.join(
        this.database.libraryRoot,
        'codex-workspace',
        'projects',
        await sha256HexAsync(Buffer.from(project.projectId!)),
      );
    return { ...project, workspace, rootPaths: roots };
  }
  async selectProject(stashId: string, selected: CodexProjectTarget) {
    this.require();
    this.source(stashId);
    if (this.repository.hasActive(stashId)) throw error('busy');
    const project = await this.resolveProject(selected, true);
    this.require();
    this.source(stashId);
    if (this.repository.hasActive(stashId)) throw error('busy');
    this.database.db.transaction(() => {
      this.repository.selectProject(stashId, project);
      this.repository.rememberProject(project);
    })();
    this.emit('changed');
    return this.state(stashId);
  }
  settings(locale: 'en' | 'zh') {
    return {
      albumId: this.repository.albumId(),
      albums: this.database.listMaterialAlbums({ locale }).map((album) => ({ id: album.id, title: album.title })),
    };
  }
  selectAlbum(id: string, locale: 'en' | 'zh') {
    this.require();
    this.repository.selectAlbum(id, locale);
    this.emit('changed');
  }
  async start(
    input: { stashId: string; requestId: string; expectedHash: string },
    albumTitle: string,
    locale: 'en' | 'zh' = 'en',
  ) {
    this.require(...executionPermissions);
    const source = this.source(input.stashId);
    const existing = this.repository.get(input.requestId);
    if (existing) {
      if (existing.task.stashId !== input.stashId || existing.input.hash !== input.expectedHash)
        throw error('conflict');
      return this.state(input.stashId);
    }
    if (source.contentHash !== input.expectedHash) throw error('conflict');
    if (source.content.format === 'markdown') {
      const expanded = this.database.contentLibrary.render(source.content.manualPrompt);
      source.content.manualPrompt = expanded.markdown;
      source.content.referenceAssetIds = [
        ...new Set([...source.content.referenceAssetIds, ...expanded.media.map((media) => media.assetId)]),
      ];
    }
    if (!source.content.manualPrompt.trim()) throw error('empty');
    if (
      source.content.manualPrompt.length > 30000 ||
      source.content.referenceAssetIds.length > 8 ||
      source.content.termIds.length ||
      source.content.wordPaletteReferences.length ||
      source.content.promptNodes.some((node) => node.kind !== 'TEXT')
    )
      throw error('source');
    if (this.repository.hasActive(input.stashId)) throw error('busy');
    const selected = this.selectedProject(input.stashId);
    if (!selected) throw error('project');
    const project = await this.resolveProject(selected, true);
    // A project choice may be invalidated while its paths are being resolved.
    const selectedExecution = this.repository.execution(input.stashId);
    const execution = await this.validateExecution(selectedExecution);
    if (this.source(input.stashId).contentHash !== input.expectedHash) throw error('conflict');
    if (JSON.stringify(this.selectedProject(input.stashId)) !== JSON.stringify(selected)) throw error('project');
    if (JSON.stringify(this.repository.execution(input.stashId)) !== JSON.stringify(selectedExecution))
      throw error('conflict');
    if (this.repository.get(input.requestId)) return this.state(input.stashId);
    if (this.repository.hasActive(input.stashId)) throw error('busy');
    this.require(...executionPermissions);
    const revision = this.database.db
      .prepare('SELECT id FROM inspiration_stash_revisions WHERE stash_id=? ORDER BY revision_no DESC LIMIT 1')
      .get(input.stashId) as { id: string } | undefined;
    const task: CodexContentTask = {
      id: input.requestId,
      stashId: input.stashId,
      revisionId: revision?.id ?? null,
      project,
      threadId: null,
      turnId: null,
      status: 'STARTING',
      errorCode: null,
      errorDetail: null,
      execution,
      albumId: this.repository.ensureAlbum(albumTitle, locale),
      outputCount: 0,
      collectionRetryable: false,
      results: [],
      createdAt: new Date().toISOString(),
    };
    this.database.db.transaction(() => {
      this.repository.selectProject(input.stashId, project);
      this.repository.create(task, input.expectedHash);
    })();
    const controller = new AbortController();
    const active: ActiveTask = {
      controller,
      completion: Promise.resolve(),
      client: new CodexAppServerClient(process.env.CODEX_BINARY || 'codex', project.workspace),
      workingItems: new Set(),
    };
    this.active.set(task.id, active);
    const taskInput: TaskInput = {
      text: source.content.manualPrompt,
      referenceAssetIds: source.content.referenceAssetIds,
      attachments: source.content.files ?? [],
    };
    active.completion = this.execute(task, active, taskInput).finally(async () => {
      await active.client.dispose();
      this.active.delete(task.id);
      this.emit('changed');
    });
    this.emit('changed');
    return this.state(input.stashId);
  }
  private recordFailure(task: CodexContentTask, reason: unknown, aborted: boolean) {
    const persisted = this.repository.get(task.id);
    if (!persisted) return;
    const failureCode = reason instanceof Error && 'code' in reason ? reason.code : null;
    const interrupted = aborted || failureCode === 'INTERRUPTED';
    const collection = task.status === 'COLLECTING' || String(reason).includes('collection');
    task.collectionRetryable = collection && persisted.outputs.length === task.outputCount;
    task.status = collection ? 'COLLECTION_FAILED' : interrupted ? 'INTERRUPTED' : 'FAILED';
    const detail = reason instanceof Error ? reason.message : String(reason);
    const needsClientUpgrade = /requires a newer version of Codex/i.test(detail);
    const sourceCode = detail.match(/\[aiy-codex-content:(source|permission|project|model)\]/)?.[1] as
      CodexContentTask['errorCode'] | undefined;
    task.errorCode = collection
      ? 'collection'
      : interrupted
        ? 'interrupted'
        : (sourceCode ??
          (needsClientUpgrade ? 'clientUpgrade' : null) ??
          (failureCode === 'EMPTY_RESPONSE'
            ? 'emptyResponse'
            : /timeout|timed out/i.test(detail)
              ? 'timeout'
              : 'execution'));
    task.errorDetail = detail.slice(0, 2000);
    this.repository.update(task);
  }
  private async execute(task: CodexContentTask, active: ActiveTask, input: TaskInput) {
    try {
      const resolved = await this.database.resolveAssetFilesAsync(input.referenceAssetIds);
      const files = input.referenceAssetIds.flatMap((assetId) => resolved.get(assetId) ?? []);
      if (
        files.length !== input.referenceAssetIds.length ||
        files.some(
          (file) =>
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimeType) ||
            file.byteSize > 25 * 1024 * 1024 ||
            /trash/i.test(file.absolutePath),
        ) ||
        files.reduce((bytes, file) => bytes + file.byteSize, 0) > 100 * 1024 * 1024
      )
        throw error('source');
      const imagePaths = new Map(
        files.map((file) => [contentAssetPath(file.assetId), pathToFileURL(file.absolutePath).href]),
      );
      for (const mediaPath of contentMarkdownMediaPaths(input.text)) {
        if (mediaPath.startsWith('assets/') && !imagePaths.has(mediaPath)) throw error('source');
      }
      const attachmentPaths: { name: string; path: string }[] = [];
      for (const file of input.attachments) {
        active.controller.signal.throwIfAborted();
        attachmentPaths.push({ name: file.name, path: await resolveNoteFile(this.database.libraryRoot, file) });
      }
      const prompt =
        replaceMarkdownMedia(input.text, imagePaths) +
        (attachmentPaths.length
          ? '\n\nAttached files selected with this note (names and local paths, JSON):\n' +
            JSON.stringify(attachmentPaths)
          : '');
      if (!task.project.rootPaths?.length) await mkdir(task.project.workspace, { recursive: true });
      active.controller.signal.throwIfAborted();
      const started = await active.client.startThread({
        cwd: task.project.workspace,
        ephemeral: false,
        userTask: true,
        developerInstructions:
          'Carry out the user-selected AIY note as a standalone task. Respect the project instructions. Do not change unrelated files or create Git branches/worktrees. For image generation, return the generated image through the image tool. Keep original reference images unchanged.',
      });
      task.threadId = started.thread.id;
      this.repository.update(task);
      await active.client.setThreadName(task.threadId, input.text.trim().slice(0, 80));
      active.controller.signal.throwIfAborted();
      this.require(...executionPermissions);
      const result = await active.client.runTurn({
        threadId: task.threadId,
        cwd: task.project.workspace,
        text: prompt,
        writableRoots: task.project.rootPaths,
        localImages: files.map((file) => file.absolutePath),
        model: task.execution.model ?? undefined,
        effort: task.execution.effort ?? undefined,
        timeoutMs: 30 * 60 * 1000,
        onStarted: (cancel, turnId) => {
          active.cancel = cancel;
          task.turnId = turnId;
          task.status = 'RUNNING';
          this.repository.update(task);
          this.emit('changed');
          if (active.controller.signal.aborted) cancel();
        },
        onEvent: (event) => {
          if (!this.enabled) {
            active.controller.abort();
            active.cancel?.();
          }
          const working = active.workingItems.size > 0;
          if (event.itemId && event.method === 'item/started' && event.toolKind) active.workingItems.add(event.itemId);
          if (event.itemId && event.method === 'item/completed') active.workingItems.delete(event.itemId);
          if (working !== active.workingItems.size > 0) this.emit('changed', { stashId: task.stashId });
        },
      });
      active.controller.signal.throwIfAborted();
      task.turnId = result.turnId;
      const outputs: OutputRequest[] = [];
      const images = result.images ?? (result.image ? [result.image] : []);
      task.outputCount = images.length;
      task.status = 'COLLECTING';
      this.repository.update(task, outputs);
      // Collection is local work; it must not keep the Codex thread owned by this app-server.
      await active.client.dispose();
      this.emit('changed');
      if (images.length > 20) throw error('collection');
      for (const [index, image] of images.entries()) {
        let outputPath = image.savedPath;
        if (!outputPath && image.result) {
          const base64 = image.result.replace(/^data:image\/png;base64,/, '');
          if (base64.length > 35 * 1024 * 1024) throw error('collection');
          const bytes = Buffer.from(base64, 'base64');
          const directory = path.join(this.database.libraryRoot, 'codex-outputs', task.id);
          await mkdir(directory, { recursive: true });
          outputPath = path.join(directory, `result-${index + 1}.png`);
          await writeFile(outputPath, bytes, { flag: 'wx' });
        }
        if (!outputPath || /trash/i.test(outputPath)) throw error('collection');
        outputs.push({
          path: path.resolve(task.project.workspace, outputPath),
          hash: '',
          requestId: `flower-${task.id}-${index}`,
          title: input.text.trim().slice(0, 100),
        });
        this.repository.update(task, outputs);
      }
      await this.collectOutputs(task, outputs, active.controller.signal);
    } catch (reason) {
      await active.client.dispose();
      this.recordFailure(task, reason, active.controller.signal.aborted);
    }
  }
  private async collectOutputs(task: CodexContentTask, outputs: OutputRequest[], signal: AbortSignal) {
    this.require(EXTENSION_PERMISSION.libraryCreateCreations);
    this.source(task.stashId);
    if (outputs.length !== task.outputCount) throw error('collection');
    for (const output of outputs) {
      signal.throwIfAborted();
      if (!output.hash) {
        if (/trash/i.test(output.path) || /trash/i.test(await realpath(output.path))) throw error('collection');
        const info = await lstat(output.path);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size > 25 * 1024 * 1024 ||
          !(await validatePngFileAsync(output.path))
        )
          throw error('collection');
        output.hash = await sha256HexAsync(await readFile(output.path, { signal }));
        this.repository.update(task, outputs);
      }
      const receipt = await this.database.importAgentIntake(
        {
          protocolVersion: 1,
          requestId: output.requestId,
          spaceId: this.database.getLocalSpace().id,
          kind: 'IMAGE_MATERIAL',
          path: output.path,
          expectedSha256: output.hash,
          title: output.title,
          provenance: { application: 'codex', ...(task.threadId ? { threadId: task.threadId } : {}) },
        },
        signal,
      );
      this.require(EXTENSION_PERMISSION.libraryCreateCreations);
      this.database.addMaterialAlbumMembers({
        albumId: task.albumId!,
        targets: [{ kind: 'MATERIAL', materialId: receipt.entityId }],
      });
      const row = this.database.db
        .prepare('SELECT image_asset_id AS assetId FROM materials WHERE id=? AND deleted_at IS NULL')
        .get(receipt.entityId) as { assetId: string } | undefined;
      if (!row?.assetId) throw error('collection');
      if (!task.results.some((result) => result.materialId === receipt.entityId))
        task.results.push({
          materialId: receipt.entityId,
          assetId: row.assetId,
          mediaUrl: mediaUrl(row.assetId),
          title: receipt.title,
          openUrl: receipt.openUrl,
        });
      this.repository.update(task);
    }
    task.status = 'COMPLETED';
    task.collectionRetryable = false;
    task.errorCode = null;
    task.errorDetail = null;
    this.repository.update(task);
    this.emit('changed');
  }
  async collect(stashId: string, taskId: string) {
    this.require(EXTENSION_PERMISSION.libraryCreateCreations);
    const value = this.repository.get(taskId);
    if (!value || value.task.stashId !== stashId) throw error('source');
    if (value.task.status !== 'COLLECTION_FAILED' || !value.task.collectionRetryable) throw error('collection');
    value.task.status = 'COLLECTING';
    this.repository.update(value.task);
    this.emit('changed');
    const collection = { controller: new AbortController(), completion: Promise.resolve() };
    this.collections.set(taskId, collection);
    collection.completion = (async () => {
      try {
        await this.collectOutputs(
          value.task,
          value.outputs,
          AbortSignal.any([collection.controller.signal, AbortSignal.timeout(30000)]),
        );
      } catch (reason) {
        value.task.status = 'COLLECTION_FAILED';
        value.task.errorCode = 'collection';
        this.repository.update(value.task);
        throw reason;
      } finally {
        this.collections.delete(taskId);
        this.emit('changed');
      }
    })();
    await collection.completion;
    return this.state(stashId);
  }
  async stop(stashId: string, taskId: string) {
    const value = this.repository.get(taskId);
    if (!value || value.task.stashId !== stashId) throw error('source');
    const collection = this.collections.get(taskId);
    if (collection) {
      collection.controller.abort();
      await Promise.allSettled([collection.completion]);
      return;
    }
    const active = this.active.get(taskId);
    if (!active) return;
    active.controller.abort();
    active.cancel?.();
    await active.client.dispose();
    await active.completion;
  }
  async openTask(stashId: string, taskId: string, stopFirst = false) {
    const task = this.repository.get(taskId)?.task;
    if (!task?.threadId || task.stashId !== stashId) throw error('source');
    if (stopFirst) await this.stop(stashId, taskId);
    else if (task.status !== 'STARTING' && task.status !== 'RUNNING') await this.active.get(taskId)?.client.dispose();
    await shell.openExternal(codexThreadHref(task.threadId));
  }
  async drain() {
    this.accepting = false;
    for (const collection of this.collections.values()) collection.controller.abort();
    await Promise.allSettled(
      [...this.collections.values()]
        .map((collection) => collection.completion)
        .concat(
          [...this.active.values()].map(async (active) => {
            active.controller.abort();
            active.cancel?.();
            await active.client.dispose();
            await active.completion;
          }),
        ),
    );
  }
  resume() {
    this.accepting = true;
  }
  async dispose() {
    this.unsubscribeExtensions();
    await this.drain();
    this.removeAllListeners();
  }
}
