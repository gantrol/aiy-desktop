import { execFile } from 'node:child_process';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const MAX_DESKTOP_INSTALLATIONS = 32;
const PROBE_CONCURRENCY = 4;
interface DesktopBinary {
  binary: string;
  version: number[];
  prerelease: string;
}

async function inspectBinary(binary: string): Promise<DesktopBinary | null> {
  try {
    if (!(await stat(binary)).isFile()) return null;
    const { stdout } = await executeFile(binary, ['--version'], {
      timeout: 3_000,
      maxBuffer: 8_192,
      windowsHide: true,
    });
    const version = stdout.match(/\bcodex-cli\s+(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?/);
    if (!version) return null;
    return { binary, version: version.slice(1, 4).map(Number), prerelease: version[4] ?? '' };
  } catch {
    return null;
  }
}

function newestFirst(left: DesktopBinary, right: DesktopBinary) {
  for (let index = 0; index < 3; index++) {
    const difference = right.version[index] - left.version[index];
    if (difference) return difference;
  }
  if (!left.prerelease || !right.prerelease) return Number(!!left.prerelease) - Number(!!right.prerelease);
  return right.prerelease.localeCompare(left.prerelease, 'en', { numeric: true });
}

async function findDesktopBinary(): Promise<string> {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (process.platform !== 'win32' || !localAppData || /trash/i.test(localAppData)) return 'codex';
  // The desktop app installs versioned CLI runtimes separately from a CLI on PATH.
  // Inspect this shallow, app-owned directory only; never search user workspaces.
  const directory = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
  const candidates = [path.join(directory, 'codex.exe')];
  try {
    for await (const entry of await opendir(directory)) {
      if (!entry.isDirectory() || !/^[a-f\d]{12,64}$/i.test(entry.name)) continue;
      candidates.push(path.join(directory, entry.name, 'codex.exe'));
      if (candidates.length > MAX_DESKTOP_INSTALLATIONS) break;
    }
  } catch {
    return 'codex';
  }
  const installations: DesktopBinary[] = [];
  for (let offset = 0; offset < candidates.length; offset += PROBE_CONCURRENCY) {
    const batch = await Promise.all(candidates.slice(offset, offset + PROBE_CONCURRENCY).map(inspectBinary));
    for (const installation of batch) if (installation) installations.push(installation);
  }
  return installations.sort(newestFirst)[0]?.binary ?? 'codex';
}

let desktopBinary: Promise<string> | null = null;

/** Resolve once per process so model discovery, health checks and turns use the same runtime. */
export function resolveCodexAppServerBinary(binary: string): Promise<string> {
  const configured = process.env.CODEX_BINARY?.trim();
  if (binary !== 'codex') return Promise.resolve(binary);
  if (configured) return Promise.resolve(configured);
  desktopBinary ??= findDesktopBinary();
  return desktopBinary;
}
