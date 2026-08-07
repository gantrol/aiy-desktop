import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAdapter, CodexTempLifecycleError, configuredImageCodexBinary } from '@/main/codex';
import type { LibraryDatabase } from '@/main/database';
import { GenerationCoordinator } from '@/main/generation';
import { CodexImageModel, GenerationModelRegistry } from '@/main/generation-models';
import type { CodexAssistInput, GenerationInput } from '@/shared/contracts';

const roots: string[] = [];
const VALID_MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function tempRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-codex-temp-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const assistInput: CodexAssistInput = {
  mode: 'optimize',
  prompt: 'portrait',
  locale: 'en',
  directTerms: [],
  recipes: [],
};

const generationInput: GenerationInput = {
  seriesId: null,
  title: '临时目录',
  manualPrompt: 'portrait',
  prompt: 'portrait',
  changeSummary: '',
  referenceAssetIds: [],
  termPromptLocale: 'en',
  termIds: [],
  wordPaletteReferences: [],
  modelKey: 'gpt-image-2',
  canvasPresetKey: null,
  width: 1024,
  height: 1536,
  quality: 'low',
};

function textPromptDraft(value: string) {
  return {
    summary: value,
    warnings: [],
    contentNodes: [{ kind: 'TEXT', text: value }],
  };
}

function healthResult(args: string[]) {
  if (args[0] === '--version') return { stdout: 'codex-test', stderr: '' };
  if (args[0] === 'login') return { stdout: 'Logged in', stderr: '' };
  return null;
}

describe('Codex image binary selection', () => {
  it('does not infer an image-specific binary from the legacy local app-data directory', () => {
    const root = tempRoot();
    const legacyBinary = path.join(root, 'OpenAI', 'Codex', 'pinned', '0.143.0', 'bin', 'codex.exe');
    mkdirSync(path.dirname(legacyBinary), { recursive: true });
    writeFileSync(legacyBinary, 'legacy');
    vi.stubEnv('LOCALAPPDATA', root);
    vi.stubEnv('CODEX_IMAGE_BINARY', '');

    expect(configuredImageCodexBinary()).toBeNull();
  });

  it('uses an image-specific binary only when explicitly configured', () => {
    vi.stubEnv('CODEX_IMAGE_BINARY', '  /opt/codex-current  ');

    expect(configuredImageCodexBinary()).toBe('/opt/codex-current');
  });
});

describe('Codex temporary job lifecycle', () => {
  it('passes only explicit conversational image paths to the Codex invocation', async () => {
    const root = tempRoot();
    let invocationArgs: string[] = [];
    const runner = vi.fn(async (_command: string, args: string[]) => {
      const health = healthResult(args);
      if (health) return health;
      invocationArgs = args;
      const outputPath = args[args.indexOf('-o') + 1];
      writeFileSync(
        outputPath,
        JSON.stringify({
          assistantMessage: 'I can see the attached references.',
          optimizedPrompt: 'portrait',
          directions: [],
        }),
      );
      return { stdout: '', stderr: '' };
    });
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;
    const codex = new CodexAdapter(database, root, 'codex-test', runner);
    await codex.refreshHealth();

    await codex.assist(
      { ...assistInput, mode: 'chat', message: 'Compare these.' },
      [],
      ['C:\\library\\objects\\first.png', 'C:\\library\\objects\\second.webp'],
    );

    expect(invocationArgs).toContain('--image');
    expect(invocationArgs).toContain('C:\\library\\objects\\first.png');
    expect(invocationArgs).toContain('C:\\library\\objects\\second.webp');
    expect(invocationArgs.filter((argument) => argument === '--image')).toHaveLength(2);
  });

  it('isolates concurrent assist output files and removes both jobs', async () => {
    const root = tempRoot();
    const jobDirs: string[] = [];
    const runner = vi.fn(async (_command: string, args: string[], _input: string, cwd: string) => {
      const health = healthResult(args);
      if (health) return health;
      jobDirs.push(cwd);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const outputPath = args[args.indexOf('-o') + 1];
      writeFileSync(
        outputPath,
        JSON.stringify({
          assistantMessage: path.basename(cwd),
          promptDraft: textPromptDraft('portrait optimized'),
          directions: [],
        }),
      );
      return { stdout: '', stderr: '' };
    });
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;
    const codex = new CodexAdapter(database, root, 'codex-test', runner);
    await codex.refreshHealth();

    const results = await Promise.all([codex.assist(assistInput), codex.assist(assistInput)]);

    expect(new Set(jobDirs).size).toBe(2);
    expect(new Set(results.map(({ assistantMessage }) => assistantMessage)).size).toBe(2);
    expect(readdirSync(path.join(root, 'temp', 'codex-assist'))).toEqual([]);
  });

  it('reports stateless work as pending until its isolated job settles', async () => {
    const root = tempRoot();
    let releaseJob!: () => void;
    const jobGate = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    const runner = vi.fn(async (_command: string, args: string[]) => {
      const health = healthResult(args);
      if (health) return health;
      await jobGate;
      const outputPath = args[args.indexOf('-o') + 1];
      writeFileSync(
        outputPath,
        JSON.stringify({
          assistantMessage: 'ready',
          promptDraft: textPromptDraft('portrait optimized'),
          directions: [],
        }),
      );
      return { stdout: '', stderr: '' };
    });
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;
    const codex = new CodexAdapter(database, root, 'codex-test', runner);
    await codex.refreshHealth();
    const pendingChanges: number[] = [];
    const unsubscribe = codex.onPendingChanged((count) => pendingChanges.push(count));

    const pending = codex.assist(assistInput);
    await vi.waitFor(() => expect(codex.hasPending).toBe(true));
    expect(codex.pendingCount).toBe(1);
    expect(pendingChanges).toEqual([1]);
    releaseJob();
    await pending;

    expect(codex.hasPending).toBe(false);
    expect(pendingChanges).toEqual([1, 0]);
    unsubscribe();
  });

  it('cancels only the requested stateless Codex process and removes its temporary job', async () => {
    const root = tempRoot();
    let requestStarted = false;
    const runner = vi.fn(
      async (
        _command: string,
        args: string[],
        _input: string,
        _cwd: string,
        _timeoutMs: number,
        _onSpawn?: (child: ChildProcessWithoutNullStreams) => void,
        signal?: AbortSignal,
      ) => {
        const health = healthResult(args);
        if (health) return health;
        requestStarted = true;
        return new Promise<never>((_resolve, reject) => {
          const cancel = () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' as const }));
          if (signal?.aborted) cancel();
          else signal?.addEventListener('abort', cancel, { once: true });
        });
      },
    );
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;
    const codex = new CodexAdapter(database, root, 'codex-test', runner);
    await codex.refreshHealth();
    const controller = new AbortController();

    const pending = codex.assist(assistInput, [], [], undefined, controller.signal);
    await vi.waitFor(() => expect(requestStarted).toBe(true));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(codex.pendingCount).toBe(0);
    expect(readdirSync(path.join(root, 'temp', 'codex-assist'))).toEqual([]);
  });

  it('removes a title job when validation fails without replacing the original error', async () => {
    const root = tempRoot();
    const runner = vi.fn(async (_command: string, args: string[], _input: string, _cwd: string) => {
      const health = healthResult(args);
      if (health) return health;
      const outputPath = args[args.indexOf('-o') + 1];
      writeFileSync(outputPath, JSON.stringify({ title: '' }));
      return { stdout: '', stderr: '' };
    });
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;
    const codex = new CodexAdapter(database, root, 'codex-test', runner);
    await codex.refreshHealth();
    const pendingChanges: number[] = [];
    codex.onPendingChanged((count) => pendingChanges.push(count));

    await expect(
      codex.suggestTitles({
        prompt: 'portrait',
        title: '',
        mode: 'regenerate',
      }),
    ).rejects.toThrow('Codex returned an empty title');
    expect(pendingChanges).toEqual([1, 0]);
    expect(readdirSync(path.join(root, 'temp', 'codex-title'))).toEqual([]);
  });

  it('cleans only direct valid assist and title jobs left by a previous process', () => {
    const root = tempRoot();
    const assistParent = path.join(root, 'temp', 'codex-assist');
    const titleParent = path.join(root, 'temp', 'codex-title');
    const validAssist = path.join(assistParent, 'abandoned-assist');
    const validTitle = path.join(titleParent, 'abandoned-title');
    const invalidAssist = path.join(assistParent, '.do-not-touch');
    mkdirSync(validAssist, { recursive: true });
    mkdirSync(validTitle, { recursive: true });
    mkdirSync(invalidAssist, { recursive: true });
    writeFileSync(path.join(validAssist, 'last-message.json'), '{}');
    writeFileSync(path.join(validTitle, 'title.json'), '{}');
    writeFileSync(path.join(invalidAssist, 'marker'), 'keep');
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;

    new CodexAdapter(database, root, 'codex-test');

    expect(existsSync(validAssist)).toBe(false);
    expect(existsSync(validTitle)).toBe(false);
    expect(existsSync(path.join(invalidAssist, 'marker'))).toBe(true);
    expect(existsSync(assistParent)).toBe(true);
    expect(existsSync(titleParent)).toBe(true);
  });

  it('never follows a junction while cleaning abandoned stateless jobs', () => {
    const root = tempRoot();
    const outside = tempRoot();
    const outsideJob = path.join(outside, 'documents');
    mkdirSync(outsideJob, { recursive: true });
    writeFileSync(path.join(outsideJob, 'keep.txt'), 'keep');
    mkdirSync(path.join(root, 'temp'), { recursive: true });
    symlinkSync(outside, path.join(root, 'temp', 'codex-assist'), process.platform === 'win32' ? 'junction' : 'dir');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;

    new CodexAdapter(database, root, 'codex-test');

    expect(readFileSync(path.join(outsideJob, 'keep.txt'), 'utf8')).toBe('keep');
    expect(error).toHaveBeenCalledWith('[codex-temp-cleanup]', {
      code: 'UNSAFE_TEMP_PATH',
      scope: 'assist',
    });
  });

  it('returns successful assist and title results even when their cleanup reports failure', async () => {
    const root = tempRoot();
    const runner = vi.fn(async (_command: string, args: string[]) => {
      const health = healthResult(args);
      if (health) return health;
      const outputPath = args[args.indexOf('-o') + 1];
      writeFileSync(
        outputPath,
        JSON.stringify(
          path.basename(outputPath) === 'title.json'
            ? { title: '雨夜霓虹' }
            : {
                assistantMessage: 'ready',
                promptDraft: textPromptDraft('portrait optimized'),
                directions: [],
              },
        ),
      );
      return { stdout: '', stderr: '' };
    });
    const remover = vi.fn((_root: string, scope: 'assist' | 'title' | 'generation') => {
      throw new CodexTempLifecycleError('CLEANUP_FAILED', scope);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;
    const codex = new CodexAdapter(database, root, 'codex-test', runner, remover);
    await codex.refreshHealth();

    await expect(codex.assist(assistInput)).resolves.toMatchObject({
      assistantMessage: 'ready',
      promptDraft: {
        contentNodes: [{ kind: 'TEXT', text: 'portrait optimized' }],
      },
    });
    await expect(
      codex.suggestTitles({
        prompt: 'rainy portrait',
        title: '',
        mode: 'regenerate',
      }),
    ).resolves.toEqual({ title: '雨夜霓虹' });
    expect(error).toHaveBeenCalledWith('[codex-temp-cleanup]', { code: 'CLEANUP_FAILED', scope: 'assist' });
    expect(error).toHaveBeenCalledWith('[codex-temp-cleanup]', { code: 'CLEANUP_FAILED', scope: 'title' });
  });

  it('preserves the original assist failure when cleanup also fails', async () => {
    const root = tempRoot();
    const runner = vi.fn(async (_command: string, args: string[]) => {
      const health = healthResult(args);
      if (health) return health;
      throw new Error('provider failed');
    });
    const remover = vi.fn((_root: string, scope: 'assist' | 'title' | 'generation') => {
      throw new CodexTempLifecycleError('CLEANUP_FAILED', scope);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
    } as unknown as LibraryDatabase;
    const codex = new CodexAdapter(database, root, 'codex-test', runner, remover);
    await codex.refreshHealth();

    await expect(codex.assist(assistInput)).rejects.toThrow('provider failed');
  });

  it('keeps the generated file through durable ingestion, then removes only that run directory', async () => {
    const root = tempRoot();
    const sibling = path.join(root, 'temp', 'generation', 'keep-me');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, 'marker'), 'keep');
    const finishGeneration = vi.fn((_runId: string, outputPath: string) => {
      expect(existsSync(outputPath)).toBe(true);
    });
    const database = {
      listGenerationRunIdsForTempCleanup: () => [],
      getReferencePaths: () => [],
      capturePromptCommonInput: () => ({
        userInstruction: generationInput.manualPrompt,
        directTermPromptLocale: 'en' as const,
        directTerms: [],
        recipes: [],
        directReferences: [],
      }),
      resolveGenerationInput: (input: GenerationInput) => input,
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series-1',
        versionId: 'version-1',
        effectiveReferenceAssetIds: [],
      }),
      freezeGenerationExecution: vi.fn(),
      markRun: vi.fn(),
      finishGeneration,
    } as unknown as LibraryDatabase;
    const runner = vi.fn(
      async (
        _command: string,
        args: string[],
        _input: string,
        cwd: string,
        _timeoutMs: number,
        onSpawn?: (child: ChildProcessWithoutNullStreams) => void,
      ) => {
        const health = healthResult(args);
        if (health) return health;
        onSpawn?.({ kill: vi.fn() } as unknown as ChildProcessWithoutNullStreams);
        writeFileSync(path.join(cwd, 'result.png'), VALID_MINIMAL_PNG);
        return { stdout: '', stderr: '' };
      },
    );
    const codex = new CodexAdapter(database, root, 'codex-test', runner);
    await codex.refreshHealth();
    const coordinator = new GenerationCoordinator(database, new GenerationModelRegistry([new CodexImageModel(codex)]));

    coordinator.start(generationInput);
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));

    expect(finishGeneration).toHaveBeenCalledOnce();
    expect(existsSync(path.join(root, 'temp', 'generation', 'run-1'))).toBe(false);
    expect(existsSync(path.join(sibling, 'marker'))).toBe(true);
  });

  it('recovers a completed interrupted PNG before startup cleanup can remove it', () => {
    const root = tempRoot();
    const interrupted = path.join(root, 'temp', 'generation', 'run-recover');
    mkdirSync(interrupted, { recursive: true });
    writeFileSync(path.join(interrupted, 'result.png'), VALID_MINIMAL_PNG);
    const finishGeneration = vi.fn((_runId: string, outputPath: string) => {
      expect(existsSync(outputPath)).toBe(true);
    });
    const markGenerationPhase = vi.fn();
    const database = {
      listRecoverableGenerationRuns: () => [{ runId: 'run-recover' }],
      listGenerationRunIdsForTempCleanup: () => ['run-recover'],
      markGenerationPhase,
      markRun: vi.fn(),
      finishGeneration,
    } as unknown as LibraryDatabase;

    new CodexAdapter(database, root, 'codex-test');

    expect(finishGeneration).toHaveBeenCalledWith('run-recover', expect.stringMatching(/result\.png$/));
    expect(markGenerationPhase).toHaveBeenCalledWith('run-recover', 'RECOVERING', 1);
    expect(existsSync(interrupted)).toBe(false);
  });

  it('does not recover a 24-byte PNG prefix without complete chunks and IEND', () => {
    const root = tempRoot();
    const interrupted = path.join(root, 'temp', 'generation', 'run-partial');
    mkdirSync(interrupted, { recursive: true });
    writeFileSync(path.join(interrupted, 'result.png'), VALID_MINIMAL_PNG.subarray(0, 24));
    const finishGeneration = vi.fn();
    const database = {
      listRecoverableGenerationRuns: () => [{ runId: 'run-partial' }],
      listGenerationRunIdsForTempCleanup: () => [],
      finishGeneration,
    } as unknown as LibraryDatabase;

    new CodexAdapter(database, root, 'codex-test');

    expect(finishGeneration).not.toHaveBeenCalled();
    expect(existsSync(path.join(interrupted, 'result.png'))).toBe(true);
  });

  it('cleans a superseded interrupted temp job only when it has no complete recoverable PNG', () => {
    const root = tempRoot();
    const generationRoot = path.join(root, 'temp', 'generation');
    const partial = path.join(generationRoot, 'run-superseded-partial');
    const complete = path.join(generationRoot, 'run-superseded-complete');
    const active = path.join(generationRoot, 'run-active');
    const unknown = path.join(generationRoot, 'unknown');
    for (const directory of [partial, complete, active, unknown]) mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(partial, 'result.png'), VALID_MINIMAL_PNG.subarray(0, 24));
    writeFileSync(path.join(complete, 'result.png'), VALID_MINIMAL_PNG);
    writeFileSync(path.join(active, 'result.png'), VALID_MINIMAL_PNG.subarray(0, 24));
    writeFileSync(path.join(unknown, 'marker'), 'keep');
    const database = {
      listRecoverableGenerationRuns: () => [{ runId: 'run-active' }],
      listGenerationRunIdsForTempCleanup: () => [],
      getGenerationJob: (runId: string) =>
        runId.startsWith('run-superseded-') ? { status: 'INTERRUPTED', desiredState: 'RUN' } : undefined,
      finishGeneration: vi.fn(),
    } as unknown as LibraryDatabase;

    new CodexAdapter(database, root, 'codex-test');

    expect(existsSync(partial)).toBe(false);
    expect(existsSync(path.join(complete, 'result.png'))).toBe(true);
    expect(existsSync(path.join(active, 'result.png'))).toBe(true);
    expect(existsSync(path.join(unknown, 'marker'))).toBe(true);
  });

  it('removes exact terminal run jobs on startup and rejects traversal identifiers', async () => {
    const root = tempRoot();
    const interrupted = path.join(root, 'temp', 'generation', 'run-interrupted');
    const untouched = path.join(root, 'temp', 'generation', 'untouched');
    mkdirSync(interrupted, { recursive: true });
    mkdirSync(untouched, { recursive: true });
    writeFileSync(path.join(interrupted, 'result.png'), 'stale');
    writeFileSync(path.join(untouched, 'marker'), 'keep');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const database = {
      listGenerationRunIdsForTempCleanup: () => ['run-interrupted', '../untouched'],
      getReferencePaths: () => [],
    } as unknown as LibraryDatabase;
    const runner = vi.fn(async (_command: string, args: string[]) => healthResult(args) ?? { stdout: '', stderr: '' });
    const codex = new CodexAdapter(database, root, 'codex-test', runner);

    expect(existsSync(interrupted)).toBe(false);
    expect(existsSync(path.join(untouched, 'marker'))).toBe(true);
    await expect(codex.prepareGeneration('../untouched', generationInput)).rejects.toMatchObject({
      name: 'CodexTempLifecycleError',
      code: 'INVALID_JOB_ID',
      scope: 'generation',
    } satisfies Partial<CodexTempLifecycleError>);
    expect(existsSync(path.join(untouched, 'marker'))).toBe(true);
  });
});
