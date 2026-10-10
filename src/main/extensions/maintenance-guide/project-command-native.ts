import path from 'node:path';
import {
  commandGroup,
  record,
  type CommandDetector,
} from '@/main/extensions/maintenance-guide/project-command-detector';

function detectCmake(d: CommandDetector) {
  const config = record(JSON.parse(d.text));
  for (const [section, operation, prefix] of [
    ['configurePresets', 'configure', []],
    ['buildPresets', 'build', ['--build']],
    ['testPresets', 'test', []],
  ] as const) {
    const presets = config[section];
    for (const raw of Array.isArray(presets) ? presets : []) {
      const preset = record(raw);
      if (preset.hidden || typeof preset.name !== 'string') continue;
      // Includes, inheritance and conditions are not evaluated or guessed.
      const incomplete = Boolean(config.include || preset.inherits || preset.condition);
      d.add({
        name: preset.name,
        tool: operation === 'test' ? 'ctest' : 'cmake',
        operation,
        group: operation === 'test' ? 'other' : 'release',
        args: [...prefix, '--preset', preset.name],
        status: incomplete ? 'incomplete' : 'ready',
      });
    }
  }
}

export function detectNativeProjectCommands(d: CommandDetector) {
  const basename = path.posix.basename(d.source);
  const name = basename.replace(/\.[^.]+$/, '');
  if (basename === 'Package.swift') {
    // Swift manifests are executable code: literal products are suggestions only.
    d.add({ name, tool: 'swift', group: 'release', operation: 'build', args: ['build', '-c', 'release'] });
    for (const match of d.text.matchAll(/\.executable\s*\(\s*name\s*:\s*"([^"\n]+)"/g))
      d.add({
        name: match[1],
        tool: 'swift',
        group: 'run',
        operation: 'run',
        args: ['run', '--product', match[1]],
        status: 'incomplete',
        origin: 'suggestion',
      });
    d.issue('partial');
  } else if (basename.endsWith('.xcscheme') && d.source.includes('/xcshareddata/xcschemes/')) {
    const container = /^(.*\.(?:xcodeproj|xcworkspace))\//.exec(d.source)?.[1];
    if (!container) {
      d.issue('partial');
      return;
    }
    const directory = path.posix.dirname(container);
    const args = [
      container.endsWith('.xcworkspace') ? '-workspace' : '-project',
      path.posix.basename(container),
      '-scheme',
      name,
    ];
    d.add({
      name,
      directory,
      tool: 'xcodebuild',
      platform: 'darwin',
      group: 'release',
      operation: 'build',
      args: [...args, '-configuration', 'Release', 'build'],
    });
    d.add({
      name,
      directory,
      tool: 'xcodebuild',
      platform: 'darwin',
      group: 'release',
      operation: 'archive',
      args: [...args, 'archive'],
      status: 'incomplete',
      origin: 'suggestion',
    });
  } else if (/\.(?:csproj|fsproj)$/i.test(basename)) {
    const conditional = /\bCondition\s*=|\$\(/i.test(d.text);
    const status = conditional ? 'incomplete' : 'ready';
    const frameworks = /<TargetFrameworks>\s*([^<]+)</i.exec(d.text)?.[1].split(';').filter(Boolean);
    const variants = frameworks?.length ? frameworks : [''];
    for (const framework of variants) {
      const target = framework ? `${name} (${framework})` : name;
      const args = framework ? ['--framework', framework] : [];
      d.add({
        name: target,
        tool: 'dotnet',
        group: 'release',
        operation: 'build',
        args: ['build', basename, '-c', 'Release', ...args],
        status,
      });
      if (/<OutputType>\s*(?:Exe|WinExe)\s*<\/OutputType>/i.test(d.text)) {
        d.add({
          name: target,
          tool: 'dotnet',
          group: 'run',
          operation: 'run',
          args: ['run', '--project', basename, ...args],
          status,
        });
        d.add({
          name: target,
          tool: 'dotnet',
          group: 'release',
          operation: 'publish',
          args: ['publish', basename, '-c', 'Release', ...args],
          status: 'incomplete',
          origin: 'suggestion',
        });
      }
    }
  } else if (/\.(?:vcxproj|sln)$/i.test(basename)) {
    d.add({
      name,
      tool: 'MSBuild',
      platform: 'win32',
      group: 'release',
      operation: 'build',
      args: [basename, '/p:Configuration=Release'],
      status: 'incomplete',
      origin: 'suggestion',
    });
  } else if (/^CMake(?:User)?Presets\.json$/.test(basename)) {
    detectCmake(d);
  } else if (basename === 'CMakeLists.txt') {
    if (!d.input.files.has(path.posix.join(path.posix.dirname(d.source), 'CMakePresets.json')))
      d.add({
        name,
        tool: 'cmake',
        group: 'release',
        operation: 'configure',
        args: ['-S', '.', '-B', 'build'],
        status: 'incomplete',
        origin: 'suggestion',
      });
  } else if (/\.ps1$/i.test(basename)) {
    d.add({
      name,
      tool: 'pwsh',
      group: commandGroup(name),
      args: ['-File', basename],
      status: /\bparam\s*\(/i.test(d.text) ? 'incomplete' : 'ready',
    });
  } else if (/\.(cmd|bat)$/i.test(basename)) {
    // Batch quoting has another expansion layer. Preserve it as a candidate to review.
    d.add({ name, tool: '', platform: 'win32', group: commandGroup(name), args: [], status: 'incomplete' });
  } else if (d.source.endsWith('.vscode/launch.json')) {
    // Do not present a dev server or a Release build as a debugger invocation.
    d.issue('partial');
    d.add({ name: 'launch.json', tool: '', group: 'debug', operation: 'debug', args: [], status: 'incomplete' });
  }
}
