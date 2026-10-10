import type { ProjectCommand } from '@/shared/contracts/project-commands';

/** Keep personal edits and retain disappeared entries for explicit removal. */
export function mergeProjectCommands(
  saved: readonly ProjectCommand[],
  detected: readonly ProjectCommand[],
  complete = true,
) {
  const previous = new Map(saved.map((command) => [command.id, command]));
  const result = detected.map((command) => {
    const old = previous.get(command.id);
    previous.delete(command.id);
    if (!old?.edited) return command;
    return {
      ...old,
      fingerprint: command.fingerprint,
      status:
        old.fingerprint === command.fingerprint && old.directory === command.directory
          ? old.status
          : ('changed' as const),
    };
  });
  for (const command of previous.values()) {
    result.push(
      command.origin === 'manual' || command.origin === 'ai'
        ? command
        : { ...command, status: complete ? 'missing' : 'incomplete' },
    );
  }
  return result;
}

export function quoteProjectCommand(program: string, args: string[], shell: ProjectCommand['shell']) {
  const quote = (value: string) => {
    if (/^[\w./:@=+-]+$/.test(value)) return value;
    if (shell === 'powershell') return `'${value.replaceAll("'", "''")}'`;
    if (shell === 'posix') return `'${value.replaceAll("'", "'\\''")}'`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  const executable = quote(program);
  return [
    shell === 'powershell' && executable.startsWith("'") ? `& ${executable}` : executable,
    ...args.map(quote),
  ].join(' ');
}
