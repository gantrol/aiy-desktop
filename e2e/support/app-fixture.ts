import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance as nodePerformance } from 'node:perf_hooks';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { startOpenAiStub, type OpenAiStubServer, type StubScript } from '../../tests/support/openai-stub-server';

export interface LaunchTiming {
  /** Monotonic timestamp captured immediately before electron.launch(). */
  startedAtMs: number;
  electronLaunchMs: number | null;
  firstWindowMs: number | null;
  domContentLoadedMs: number | null;
}

export interface AppDiagnostics {
  mainErrors: string[];
  rendererErrors: string[];
  networkFailures: string[];
}

export interface AppFixtures {
  /** Loopback provider stub. Every journey gets one; none may reach the internet. */
  stub: OpenAiStubServer;
  app: ElectronApplication;
  page: Page;
  /** Per-test temp local space. Nothing touches the developer's real library. */
  userDataDir: string;
  launchTiming: LaunchTiming;
  diagnostics: AppDiagnostics;
}

export interface AppWorkerOptions {
  stubScript: StubScript;
  workerReadyDelayMs: number;
  intakeCommitDelayMs: number;
}

const appRoot = path.resolve(__dirname, '../..');
const observedRendererPages = new WeakSet<Page>();

function observeRenderer(page: Page, diagnostics: AppDiagnostics) {
  if (observedRendererPages.has(page)) return;
  observedRendererPages.add(page);
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.rendererErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.rendererErrors.push(error.message));
  page.on('crash', () => diagnostics.rendererErrors.push('Renderer process crashed'));
  page.on('requestfailed', (request) => {
    diagnostics.networkFailures.push(
      `${request.failure()?.errorText ?? 'request failed'} ${request.resourceType()} ${request.url()}`,
    );
  });
}

function workerPids(userDataDir: string) {
  const librariesRoot = path.join(userDataDir, 'libraries');
  if (!existsSync(librariesRoot)) return [];
  return readdirSync(librariesRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const descriptorPath = path.join(librariesRoot, entry.name, 'temp', 'model-worker.json');
    if (!existsSync(descriptorPath)) return [];
    try {
      const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as { pid?: unknown };
      return typeof descriptor.pid === 'number' && descriptor.pid > 0 ? [descriptor.pid] : [];
    } catch {
      return [];
    }
  });
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeE2eUserDataDir(directory: string) {
  const temporaryRoot = path.resolve(tmpdir());
  const target = path.resolve(directory);
  const relative = path.relative(temporaryRoot, target);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative) ||
    !path.basename(target).startsWith('aiy-e2e-')
  ) {
    throw new Error(`Refusing to remove an unexpected E2E user-data directory: ${target}`);
  }
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function waitForProcessesToExit(pids: number[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(processIsAlive) && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

async function attemptWithin(promise: Promise<unknown>, timeoutMs: number) {
  await Promise.race([promise.catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

async function closeAppGracefully(app: ElectronApplication, userDataDir: string) {
  const detachedWorkerPids = workerPids(userDataDir);
  const appProcess = app.process();
  const exited = new Promise<void>((resolve) => {
    if (appProcess.exitCode !== null) resolve();
    else appProcess.once('exit', () => resolve());
  });
  const page = app.windows()[0];
  if (page && !page.isClosed()) {
    await attemptWithin(
      page.evaluate(() => window.desktopApi.appRequestQuit()),
      2_000,
    );
  }
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  if (appProcess.exitCode === null) await attemptWithin(app.close(), 3_000);
  if (appProcess.exitCode === null) {
    // This process was launched for the current isolated journey. A bounded
    // fallback keeps a wedged main process from consuming the entire test
    // timeout and hiding the journey's real assertion failure.
    if (appProcess.pid !== undefined) {
      try {
        process.kill(appProcess.pid, 'SIGTERM');
      } catch {
        /* already exited */
      }
    }
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
  }
  await waitForProcessesToExit(detachedWorkerPids, 5_000);
  for (const pid of detachedWorkerPids.filter(processIsAlive)) {
    // The worker belongs to this test's isolated user-data directory and the
    // journey has no pending generation. Terminate only as a bounded fallback
    // when graceful shutdown did not release its Windows working directory.
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already exited */
    }
  }
  await waitForProcessesToExit(detachedWorkerPids, 1_000);
}

async function installDeterministicModelIpcStubs(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    // Automatic creation titles are model-backed but are not the behavior
    // exercised by local replay journeys. Replace only that IPC boundary so a
    // test can never consume a configured Codex account or leave a title task
    // pending during teardown. This runs after firstWindow(), once production
    // IPC registration has completed, to avoid a startup registration race.
    ipcMain.removeHandler('codex:suggest-titles');
    ipcMain.handle('codex:suggest-titles', (_event, raw: unknown) => {
      const input = raw as { title?: unknown };
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      return {
        title: title || 'E2E Local Replay',
      };
    });
  });
}

export const test = base.extend<AppFixtures & AppWorkerOptions>({
  stubScript: [{}, { option: true }],
  workerReadyDelayMs: [0, { option: true }],
  intakeCommitDelayMs: [0, { option: true }],

  launchTiming: async ({}, use) => {
    await use({
      startedAtMs: 0,
      electronLaunchMs: null,
      firstWindowMs: null,
      domContentLoadedMs: null,
    });
  },

  diagnostics: async ({}, use, testInfo) => {
    const diagnostics: AppDiagnostics = { mainErrors: [], rendererErrors: [], networkFailures: [] };
    await use(diagnostics);
    if (diagnostics.mainErrors.length || diagnostics.rendererErrors.length || diagnostics.networkFailures.length) {
      await testInfo.attach('electron-errors.json', {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: 'application/json',
      });
    }
  },

  stub: async ({ stubScript }, use) => {
    const stub = await startOpenAiStub(stubScript);
    await use(stub);
    await stub.close();
  },

  userDataDir: async ({}, use) => {
    // Keep object-store paths comfortably below Windows' legacy MAX_PATH.
    // Nesting the library under test-results/<long test title>/ made valid
    // fixture media unreadable to Chromium once paths crossed 260 characters.
    const directory = mkdtempSync(path.join(tmpdir(), 'aiy-e2e-'));
    try {
      await use(directory);
    } finally {
      // app depends on this fixture, so its teardown (including detached model
      // workers) completes before this exact directory is removed.
      await removeE2eUserDataDir(directory);
    }
  },

  app: async ({ stub, userDataDir, launchTiming, diagnostics, workerReadyDelayMs, intakeCommitDelayMs }, use) => {
    launchTiming.startedAtMs = nodePerformance.now();
    const launchEnvironment = { ...process.env };
    delete launchEnvironment.NO_COLOR;
    const app = await electron.launch({
      // Launch the application directory so Electron resolves package.json,
      // app.getAppPath(), built-in resources, and the icon exactly as dev and
      // packaged launches do. Launching the compiled entry directly makes
      // out/main the application root and shifts every resource path.
      args: ['.'],
      cwd: appRoot,
      env: {
        ...launchEnvironment,
        // Existing production seam: redirects the whole local space.
        AIY_USER_DATA_DIR: userDataDir,
        AIY_E2E: '1',
        AIY_STUB_BASE_URL: stub.url,
        // Keep the worker alive for the duration of a journey so an idle exit
        // never races an assertion.
        AIY_MODEL_WORKER_IDLE_EXIT_MS: '600000',
        AIY_E2E_MODEL_WORKER_READY_DELAY_MS: String(workerReadyDelayMs),
        AIY_E2E_INTAKE_COMMIT_DELAY_MS: String(intakeCommitDelayMs),
        AIY_ENABLE_INTERNAL_MODELS: '1',
        OPENAI_API_KEY: '',
        DEEPSEEK_API_KEY: '',
      },
    });
    launchTiming.electronLaunchMs = nodePerformance.now() - launchTiming.startedAtMs;
    let fixtureTeardownStarted = false;
    app.process().once('exit', (code, signal) => {
      if (fixtureTeardownStarted) return;
      diagnostics.mainErrors.push(
        `Electron host exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      );
    });

    app.on('console', (message) => {
      if (message.type() !== 'error') return;
      const location = message.location();
      const source = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : '';
      diagnostics.mainErrors.push(`${message.text()}${source}`);
    });
    app.on('window', (window) => observeRenderer(window, diagnostics));
    for (const window of app.windows()) observeRenderer(window, diagnostics);

    // Native dialogs block forever under automation. Replaced in the main
    // process, so no production branch is needed for testability.
    //
    // `showErrorBox` matters most: the startup failure path in `main/index.ts`
    // calls it before `app.quit()`, and it is modal — an unstubbed startup error
    // freezes the main process instead of failing, which is why an unexplained
    // hang here almost always means startup threw. The stub records the message
    // so the test reports the real cause.
    try {
      await app.evaluate(async ({ dialog }) => {
        const captured: Array<{ title: string; detail: string }> = [];
        (globalThis as Record<string, unknown>).__aiyStartupErrors = captured;
        dialog.showErrorBox = (title, detail) => {
          captured.push({ title, detail });
        };
        dialog.showMessageBox = (async (...args: unknown[]) => {
          const options = args.at(-1) as { buttons?: string[]; cancelId?: number } | undefined;
          const cancelPendingTasks = options?.buttons?.length === 4 && options.cancelId === 3;
          return { response: cancelPendingTasks ? 1 : 0, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
        dialog.showMessageBoxSync = () => 0;
      });
    } catch (error) {
      throw new Error(
        'The Electron main process did not respond after launch. It is blocked or already quitting.\n' +
          'Most common causes:\n' +
          '  - startup threw and a modal error dialog is blocking the main process\n' +
          '  - a stray electron.exe from an earlier run holds the single-instance lock\n' +
          '    (the model worker is spawned detached and unref()d, so it outlives the app)\n' +
          `  - the bundle in out/ is stale; rebuild with \`npm run build\`\n\nOriginal: ${String(error)}`,
      );
    }

    await use(app);

    fixtureTeardownStarted = true;
    const startupErrors = await Promise.race([
      app
        .evaluate(() => (globalThis as Record<string, unknown>).__aiyStartupErrors ?? [])
        .catch(() => [] as Array<{ title: string; detail: string }>),
      new Promise<Array<{ title: string; detail: string }>>((resolve) => setTimeout(() => resolve([]), 2_000)),
    ]);
    await closeAppGracefully(app, userDataDir);
    if (Array.isArray(startupErrors) && startupErrors.length > 0) {
      throw new Error(`Main process reported a startup failure: ${JSON.stringify(startupErrors)}`);
    }
  },

  page: async ({ app, launchTiming }, use) => {
    const page = await app.firstWindow();
    launchTiming.firstWindowMs ??= nodePerformance.now() - launchTiming.startedAtMs;
    await installDeterministicModelIpcStubs(app);
    await page.waitForLoadState('domcontentloaded');
    launchTiming.domContentLoadedMs ??= nodePerformance.now() - launchTiming.startedAtMs;
    await use(page);
  },
});

export const { expect } = base;

/** Queues file paths for the next `showOpenDialog`, in place of a real picker. */
export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]) {
  await app.evaluate(async ({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: paths.length === 0, filePaths: paths });
  }, filePaths);
}

/** Queues a destination for the next `showSaveDialog`. */
export async function stubSaveDialog(app: ElectronApplication, filePath: string | null) {
  await app.evaluate(async ({ dialog }, target) => {
    dialog.showSaveDialog = async () =>
      target ? { canceled: false, filePath: target } : { canceled: true, filePath: '' };
  }, filePath);
}

/** Per-process memory, for the performance journeys. */
export async function appMetrics(app: ElectronApplication) {
  return app.evaluate(async ({ app: electronApp }) =>
    electronApp.getAppMetrics().map((metric) => ({
      type: metric.type,
      workingSetKb: metric.memory.workingSetSize,
      cpuPercent: metric.cpu.percentCPUUsage,
    })),
  );
}
