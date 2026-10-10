import { createHash } from 'node:crypto';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { parse as parseToml } from 'smol-toml';
import type { ProjectCommand, ProjectCommandScan } from '@/shared/contracts/project-commands';
import { projectCommandScanSchema } from '@/shared/contracts/project-commands';
import { quoteProjectCommand } from '@/shared/project-commands';
import type { ProjectCommandFiles } from '@/main/extensions/maintenance-guide/project-command-files';
import { detectNativeProjectCommands } from '@/main/extensions/maintenance-guide/project-command-native';

type Candidate = Pick<ProjectCommand, 'name' | 'tool' | 'group'> &
  Partial<Pick<ProjectCommand, 'operation' | 'platform' | 'status' | 'origin'>> & {
    args: string[];
    directory?: string;
    key?: string;
  };
export interface CommandDetector {
  input: ProjectCommandFiles;
  source: string;
  text: string;
  add(candidate: Candidate): void;
  issue(code: ProjectCommandScan['issues'][number]['code']): void;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function commandGroup(name: string): ProjectCommand['group'] {
  if (/(?:^|[-:])(debug|inspect)(?:$|[-:])/i.test(name)) return 'debug';
  if (/(?:^|[-:])(build|release|publish|deploy|package|archive)(?:$|[-:])/i.test(name)) return 'release';
  if (/(?:^|[-:])(dev|start|run|serve|watch)(?:$|[-:])/i.test(name)) return 'run';
  return 'other';
}

function detectNode(d: CommandDetector) {
  const pkg = record(JSON.parse(d.text));
  let directory = path.posix.dirname(d.source);
  let manager: string | undefined;
  // A nearest packageManager declaration or lockfile determines the runner.
  while (!manager) {
    const manifest = d.input.files.get(path.posix.join(directory, 'package.json'));
    const declared = manifest ? record(JSON.parse(manifest)).packageManager : undefined;
    if (typeof declared === 'string') {
      manager = /^(npm|pnpm|yarn|bun)@/.exec(declared)?.[1];
      if (!manager) break;
    } else {
      const locks = [
        ['npm', 'package-lock.json'],
        ['npm', 'npm-shrinkwrap.json'],
        ['pnpm', 'pnpm-lock.yaml'],
        ['yarn', 'yarn.lock'],
        ['bun', 'bun.lock'],
        ['bun', 'bun.lockb'],
      ].filter(([, file]) => d.input.entries.has(path.posix.join(directory, file)));
      const managers = [...new Set(locks.map(([tool]) => tool))];
      if (managers.length > 1) break;
      manager = managers[0];
    }
    if (manager || directory === '.') break;
    directory = path.posix.dirname(directory);
  }
  if (!manager) d.issue('manager');
  for (const [name, script] of Object.entries(record(pkg.scripts))) {
    if (typeof script !== 'string' || !script.trim()) continue;
    d.add({
      name,
      tool: manager ?? '',
      args: ['run', name],
      group: commandGroup(name),
      status: manager ? 'ready' : 'incomplete',
    });
  }
}

function detectCargo(d: CommandDetector) {
  const config = record(parseToml(d.text));
  const pkg = record(config.package);
  const name = typeof pkg.name === 'string' ? pkg.name : path.posix.basename(path.posix.dirname(d.source));
  const base = path.posix.dirname(d.source);
  const bins = new Map<string, string[]>();
  if (pkg.autobins !== false && typeof pkg.name === 'string') {
    if (d.input.entries.has(path.posix.join(base, 'src/main.rs'))) bins.set(pkg.name, []);
    const prefix = path.posix.join(base, 'src/bin') + '/';
    for (const entry of d.input.entries) {
      if (!entry.startsWith(prefix)) continue;
      const relative = entry.slice(prefix.length);
      if (/^[^/]+\.rs$/.test(relative)) bins.set(relative.slice(0, -3), []);
      else if (/^[^/]+\/main\.rs$/.test(relative)) bins.set(relative.split('/')[0], []);
    }
  }
  for (const raw of Array.isArray(config.bin) ? config.bin : []) {
    const bin = record(raw);
    if (typeof bin.name === 'string') {
      const features = bin['required-features'];
      bins.set(bin.name, Array.isArray(features) ? features.filter((v): v is string => typeof v === 'string') : []);
    }
  }
  for (const [bin, features] of bins)
    d.add({
      name: bin,
      tool: 'cargo',
      group: 'run',
      operation: 'run',
      args: ['run', '--bin', bin, ...(features.length ? ['--features', features.join(',')] : [])],
    });
  const workspace = !pkg.name && config.workspace ? ['--workspace'] : [];
  d.add({ name, tool: 'cargo', group: 'release', operation: 'build', args: ['build', '--release', ...workspace] });
  d.add({ name, tool: 'cargo', group: 'other', operation: 'test', args: ['test', ...workspace] });
  if (pkg.name && pkg.publish !== false && !(Array.isArray(pkg.publish) && pkg.publish.length === 0))
    d.add({
      name,
      tool: 'cargo',
      group: 'release',
      operation: 'publish',
      args: ['publish'],
      origin: 'suggestion',
      status: 'incomplete',
    });
}

export async function detectProjectCommands(
  input: ProjectCommandFiles,
  check: () => void,
): Promise<ProjectCommandScan> {
  const commands = new Map<string, ProjectCommand>();
  const issues = [...input.issues];
  const shell = process.platform === 'win32' ? 'powershell' : 'posix';
  for (const [source, text] of [...input.files].sort(([a], [b]) => a.localeCompare(b))) {
    check();
    const issue = (code: ProjectCommandScan['issues'][number]['code']) => {
      if (issues.length < 128 && !issues.some((item) => item.path === source && item.code === code))
        issues.push({ path: source, code });
    };
    const detector: CommandDetector = {
      input,
      source,
      text,
      issue,
      add(candidate) {
        if (commands.size >= 256) {
          issue('limit');
          return;
        }
        const directory = path.resolve(input.root, candidate.directory ?? path.posix.dirname(source));
        const id = hash(
          [source, candidate.tool, candidate.key ?? candidate.name, candidate.operation ?? ''].join('\0'),
        );
        const command: ProjectCommand = {
          id,
          name: candidate.name,
          group: candidate.group,
          operation: candidate.operation,
          command: candidate.tool ? quoteProjectCommand(candidate.tool, candidate.args, shell) : '',
          directory,
          source,
          fingerprint: hash(text + '\0' + directory),
          tool: candidate.tool,
          platform: candidate.platform ?? 'any',
          shell,
          origin: candidate.origin ?? 'configuration',
          status: candidate.status ?? 'ready',
          edited: false,
          detail: '',
        };
        if (
          command.name.length > 200 ||
          command.command.length > 8000 ||
          directory.length > 4096 ||
          source.length > 4096
        ) {
          issue('limit');
          return;
        }
        commands.set(id, command);
      },
    };
    try {
      if (path.posix.basename(source) === 'package.json') detectNode(detector);
      else if (path.posix.basename(source) === 'Cargo.toml') detectCargo(detector);
      else detectNativeProjectCommands(detector);
    } catch {
      issue('invalid');
    }
    await setImmediate();
  }
  check();
  return projectCommandScanSchema.parse({
    commands: [...commands.values()],
    issues,
    scannedAt: new Date().toISOString(),
  });
}
