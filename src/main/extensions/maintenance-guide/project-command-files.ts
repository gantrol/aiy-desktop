import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { approvedLocalPath } from '@/main/extensions/maintenance-guide/store';
import type { ProjectCommandScan } from '@/shared/contracts/project-commands';

export interface ProjectCommandFiles {
  root: string;
  files: Map<string, string>;
  entries: Set<string>;
  issues: ProjectCommandScan['issues'];
}

const skippedDirectories = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'target',
  '.build',
  'build',
  'dist',
  'out',
  '.next',
  'bin',
  'obj',
  'vendor',
  'pods',
]);
const maximumFileBytes = 512 * 1024;
const maximumTotalBytes = 8 * 1024 * 1024;
const knownConfiguration =
  /(?:^|\/)(?:package\.json|Cargo\.toml|Package\.swift|CMakeLists\.txt|CMake(?:User)?Presets\.json)$|\.(?:csproj|fsproj|vcxproj|sln|xcscheme|ps1|cmd|bat)$/i;

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readConfiguration(
  result: ProjectCommandFiles,
  relative: string,
  budget: { bytes: number },
  check: () => void,
) {
  const issue = (code: ProjectCommandScan['issues'][number]['code']) => {
    if (result.issues.length < 128) result.issues.push({ path: relative, code });
  };
  const filePath = path.join(result.root, relative);
  try {
    const before = await lstat(filePath);
    if (!before.isFile() || before.isSymbolicLink() || !inside(result.root, await realpath(filePath))) {
      issue('boundary');
      return;
    }
    if (before.size > maximumFileBytes || budget.bytes + before.size > maximumTotalBytes) {
      issue('limit');
      return;
    }
    check();
    const file = await open(filePath, 'r');
    try {
      const opened = await file.stat();
      if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
        throw new Error('File changed');
      const buffer = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < buffer.length) {
        check();
        const read = await file.read(buffer, offset, Math.min(65536, buffer.length - offset), offset);
        if (!read.bytesRead) throw new Error('File changed');
        offset += read.bytesRead;
        budget.bytes += read.bytesRead;
      }
      const after = await file.stat();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('File changed');
      check();
      result.files.set(relative, new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    } finally {
      await file.close();
    }
  } catch {
    check();
    issue('unreadable');
  }
}

/** Read only recognized configuration files, with one bounded read in flight. */
export async function readProjectCommandFiles(directory: string, check: () => void): Promise<ProjectCommandFiles> {
  check();
  approvedLocalPath(directory);
  const rootInfo = await lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Invalid project directory');
  const root = await realpath(directory);
  approvedLocalPath(root);
  const result: ProjectCommandFiles = { root, files: new Map(), entries: new Set(), issues: [] };
  const issue = (file: string, code: ProjectCommandScan['issues'][number]['code']) => {
    if (result.issues.length < 128) result.issues.push({ path: file, code });
  };
  const queue = [{ relative: '', depth: 0 }];
  let entries = 0;
  const budget = { bytes: 0 };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    check();
    const current = queue[cursor];
    const directoryPath = path.join(root, current.relative);
    if (/trash/i.test(directoryPath)) continue;
    try {
      const stat = await lstat(directoryPath);
      if (stat.isSymbolicLink() || !inside(root, await realpath(directoryPath))) {
        issue(current.relative, 'boundary');
        continue;
      }
      const handle = await opendir(directoryPath);
      for await (const entry of handle) {
        check();
        if (++entries > 8192) {
          issue(current.relative, 'limit');
          return result;
        }
        const relative = path.posix.join(current.relative, entry.name);
        if (/trash/i.test(relative)) continue;
        if (entry.isSymbolicLink()) {
          issue(relative, 'boundary');
          continue;
        }
        if (entry.isDirectory()) {
          // Rust's src/bin is source, unlike generated bin directories.
          if (
            skippedDirectories.has(entry.name.toLowerCase()) &&
            !(entry.name === 'bin' && path.posix.basename(current.relative) === 'src')
          )
            continue;
          if (current.depth >= 8 || queue.length >= 512) issue(relative, 'limit');
          else queue.push({ relative, depth: current.depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        result.entries.add(relative);
        if (!knownConfiguration.test(relative) && !relative.endsWith('.vscode/launch.json')) continue;
        if (result.files.size >= 128 || budget.bytes >= maximumTotalBytes) {
          issue(relative, 'limit');
          continue;
        }
        await readConfiguration(result, relative, budget, check);
      }
    } catch {
      check();
      issue(current.relative, 'unreadable');
    }
  }
  return result;
}
