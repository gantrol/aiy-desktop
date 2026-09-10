import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDevelopmentElectronExecutable } from './windows-development-executable.mjs';

const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const previewStartedAt = Date.now();
const cacheDirectory = path.join(applicationRoot, '.tmp', 'preview-build');
const targets = ['main', 'preload', 'renderer'];
const metadataConcurrency = 16;
const buildConcurrency = Math.min(2, availableParallelism());
const ignoredDirectories = new Set(['.tmp', '.git', 'node_modules', 'out', 'dist']);
const arguments_ = process.argv.slice(2);
const buildOnly = arguments_.includes('--build-only');
const force = arguments_.includes('--force');
const forwardedArguments = arguments_.filter((argument) => argument !== '--build-only' && argument !== '--force');

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function optionalStat(file) {
  try {
    return await stat(file, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function directoryFiles(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (file.toLowerCase().includes('trash')) continue;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) pending.push(file);
      } else {
        files.push(file);
      }
    }
  }
  return files;
}

async function fingerprint(files) {
  const sortedFiles = [...new Set(files)].sort((left, right) => left.localeCompare(right, 'en'));
  const records = new Array(sortedFiles.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(metadataConcurrency, sortedFiles.length) }, async () => {
      while (cursor < sortedFiles.length) {
        const index = cursor++;
        const file = sortedFiles[index];
        const information = await optionalStat(file);
        // ctime also detects replacements and edits that preserve size and mtime.
        records[index] = [
          path.relative(applicationRoot, file),
          information ? [information.size, information.mtimeNs, information.ctimeNs].map(String) : null,
        ];
      }
    }),
  );
  return hash(records);
}

async function sourceFingerprints(environmentFingerprint) {
  const rootEntries = await readdir(applicationRoot);
  const configurationFiles = rootEntries
    .filter((name) => /^(?:package(?:-lock)?\.json|.*\.config\.[cm]?[jt]s|tsconfig.*\.json|\.env(?:\..*)?)$/.test(name))
    .map((name) => path.join(applicationRoot, name));
  const commonDirectories = ['src/shared', 'scripts', 'extensions', 'configuration'];
  const commonFiles = (
    await Promise.all(commonDirectories.map((name) => directoryFiles(path.join(applicationRoot, name))))
  )
    .flat()
    .concat(configurationFiles, [
      path.join(applicationRoot, 'node_modules'),
      path.join(applicationRoot, 'node_modules/.package-lock.json'),
    ]);
  const commonFingerprint = await fingerprint(commonFiles);
  const fingerprints = {};
  for (const target of targets) {
    const files = await directoryFiles(path.join(applicationRoot, 'src', target));
    fingerprints[target] = hash([commonFingerprint, environmentFingerprint, process.version, await fingerprint(files)]);
  }
  return fingerprints;
}

async function outputFingerprint(target) {
  const files = await directoryFiles(path.join(applicationRoot, 'out', target));
  return files.length ? fingerprint(files) : null;
}

async function readCache() {
  try {
    const cache = JSON.parse(await readFile(path.join(cacheDirectory, 'cache.json'), 'utf8'));
    return cache?.version === 1 ? (cache.targets ?? {}) : {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function compileTargets(pending, inputs, next) {
  const { resolveConfig } = await import('electron-vite');
  const { build } = await import('vite');
  const resolved = await resolveConfig({ root: applicationRoot, logLevel: 'warn' }, 'build', 'production');
  // Rolldown does CPU work in native threads. Share one config load and process
  // instead of paying for a separate Node/Vite startup for every target.
  const queue = ['renderer', 'main', 'preload'].filter((target) => pending.includes(target));
  let cursor = 0;
  let failure;
  await Promise.all(
    Array.from({ length: Math.min(buildConcurrency, queue.length) }, async () => {
      while (!failure && cursor < queue.length) {
        const target = queue[cursor++];
        const started = performance.now();
        console.info(`[preview] ${target}: building`);
        try {
          const config = resolved.config?.[target];
          if (!config) throw new Error(`Missing ${target} build configuration.`);
          await build(config);
          next[target] = { input: inputs[target], output: await outputFingerprint(target) };
          console.info(`[preview] ${target}: built in ${((performance.now() - started) / 1000).toFixed(2)}s`);
        } catch (error) {
          // Finish active builds before reporting failure; schedule no new work.
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;
}

async function buildPreview() {
  const started = performance.now();
  process.env.NODE_ENV = 'production';
  process.env.NODE_ENV_ELECTRON_VITE = 'production';
  // electron-vite adds derived environment values while resolving its presets.
  // Capture the caller's environment once so those values do not invalidate it.
  const environmentFingerprint = hash(
    Object.entries(process.env)
      .filter(([key]) => !/^(?:npm_(?:lifecycle_|command$|execpath$|node_execpath$)|INIT_CWD$|_$)/i.test(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const inputs = await sourceFingerprints(environmentFingerprint);
  const cached = force ? {} : await readCache();
  const next = {};
  const pending = [];
  for (const target of targets) {
    const output = await outputFingerprint(target);
    if (cached[target]?.input === inputs[target] && output && cached[target]?.output === output) {
      next[target] = cached[target];
      console.info(`[preview] ${target}: unchanged, reusing production build`);
      continue;
    }
    pending.push(target);
  }
  if (pending.length) {
    await compileTargets(pending, inputs, next);
    const currentInputs = await sourceFingerprints(environmentFingerprint);
    const changedTargets = targets.filter((target) => currentInputs[target] !== inputs[target]);
    for (const target of changedTargets) delete next[target];
    await mkdir(cacheDirectory, { recursive: true });
    const temporaryCache = path.join(cacheDirectory, `cache-${process.pid}.json`);
    await writeFile(temporaryCache, JSON.stringify({ version: 1, targets: next }));
    await rename(temporaryCache, path.join(cacheDirectory, 'cache.json'));
    if (changedTargets.length) {
      throw new Error(`${changedTargets.join(', ')} inputs changed during compilation. Run preview again.`);
    }
  }
  console.info(`[preview] Production bundles ready in ${((performance.now() - started) / 1000).toFixed(2)}s`);
  return next.renderer.output;
}

async function removeRendererSnapshot(snapshotRoot) {
  const relative = path.relative(cacheDirectory, snapshotRoot);
  if (path.dirname(relative) !== '.' || !path.basename(relative).startsWith('renderer-')) {
    throw new Error('Refusing to remove a renderer snapshot outside the preview cache.');
  }
  await rm(snapshotRoot, { recursive: true, force: true, maxRetries: 3 });
}

async function createRendererSnapshot(expectedOutput) {
  const started = performance.now();
  await mkdir(cacheDirectory, { recursive: true });
  const snapshotRoot = await mkdtemp(path.join(cacheDirectory, 'renderer-'));
  try {
    // Copy instead of linking: another build can replace or rewrite out/renderer
    // while this window still needs its original lazy JavaScript and CSS chunks.
    await cp(path.join(applicationRoot, 'out', 'renderer'), snapshotRoot, {
      recursive: true,
      filter: (source) => !source.toLowerCase().includes('trash'),
    });
    if ((await outputFingerprint('renderer')) !== expectedOutput) {
      throw new Error('Renderer output changed while preparing Preview. Run preview again.');
    }
    console.info(`[preview] Renderer snapshot ready in ${((performance.now() - started) / 1000).toFixed(2)}s`);
    return snapshotRoot;
  } catch (error) {
    await removeRendererSnapshot(snapshotRoot);
    throw error;
  }
}

async function runElectronVite(command, options) {
  const cli = path.join(applicationRoot, 'node_modules/electron-vite/bin/electron-vite.js');
  const environment = { ...process.env };
  if (command === 'preview') {
    environment.ELECTRON_EXEC_PATH = await resolveDevelopmentElectronExecutable(applicationRoot);
  }
  const child = spawn(process.execPath, [cli, command, ...options], {
    cwd: applicationRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function launchPreview(rendererOutput) {
  const electronPath = await resolveDevelopmentElectronExecutable(applicationRoot);
  const args = process.env.ELECTRON_CLI_ARGS ? JSON.parse(process.env.ELECTRON_CLI_ARGS) : [];
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new Error('ELECTRON_CLI_ARGS must be an array of strings.');
  }
  if (process.env.NO_SANDBOX === '1') args.push('--no-sandbox');
  const snapshotRoot = await createRendererSnapshot(rendererOutput);
  try {
    console.info('\nstarting electron app...\n');
    // Do not use windowsHide for the Electron process. On Windows it can also
    // suppress Electron's first BrowserWindow instead of only hiding a console.
    const child = spawn(electronPath, [process.env.ELECTRON_ENTRY || '.', ...args], {
      cwd: applicationRoot,
      env: {
        ...process.env,
        AIY_PREVIEW_STARTED_AT: String(previewStartedAt),
        AIY_PREVIEW_RENDERER_ROOT: snapshotRoot,
      },
      stdio: 'inherit',
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    await removeRendererSnapshot(snapshotRoot);
  }
}

async function main() {
  // Custom electron-vite modes/configs retain their original CLI behavior and
  // never populate the default production cache with incompatible artifacts.
  if (forwardedArguments.length) {
    await runElectronVite(buildOnly ? 'build' : 'preview', forwardedArguments);
    return;
  }
  const rendererOutput = await buildPreview();
  if (!buildOnly) await launchPreview(rendererOutput);
}

main().catch((error) => {
  console.error('[preview]', error);
  process.exitCode = 1;
});
