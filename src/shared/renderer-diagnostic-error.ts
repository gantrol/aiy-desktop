import type { RendererDiagnosticError } from '@/shared/contracts/renderer-diagnostics';

const categories: [RegExp, RendererDiagnosticError['category']][] = [
  [/maximum update depth/i, 'update-depth'],
  [/too many re-renders/i, 'render-loop'],
  [/rendered (?:more|fewer) hooks|order of hooks/i, 'hook-order'],
  [/invalid hook call/i, 'invalid-hook'],
  [/objects are not valid as a react child/i, 'invalid-child'],
  [/cannot (?:read|set) propert|undefined is not|null is not/i, 'undefined-access'],
  [/is not a function|is not callable/i, 'not-callable'],
  [
    /failed to fetch dynamically imported|importing a module|does not provide an export|failed to load|err_connection/i,
    'module-load',
  ],
  [/syntaxerror|unexpected token|unexpected identifier/i, 'syntax'],
];

/** Keep code locations, never the first stack line (which repeats the raw error message). */
function codeFrames(stack: string) {
  return stack
    .split('\n')
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, 16)
    .map((line) => {
      const frame = line
        .replaceAll('\\', '/')
        .replace(/\?[^\s):]*/g, '')
        .trim();
      const location = frame.match(/([\w@./-]+:\d+:\d+)\)?$/)?.[1];
      const name = frame.match(/^at ([\w.$<>[\]-]+)(?:\s|$)/)?.[1] ?? 'anonymous';
      return `${name}${location ? ` ${location}` : ''}`.slice(0, 500);
    });
}

export function rendererDiagnosticError(reason: unknown): RendererDiagnosticError {
  // Arbitrary rejection objects can contain user content or credentials. Do not serialize them.
  try {
    const rawMessage: unknown = reason instanceof Error ? reason.message : reason;
    const message = typeof rawMessage === 'string' ? rawMessage : '';
    const rawName: unknown = reason instanceof Error ? reason.name : null;
    const rawStack: unknown = reason instanceof Error ? reason.stack : null;
    return {
      name: typeof rawName === 'string' && /^[\w.-]{1,80}$/.test(rawName) ? rawName : 'UnknownError',
      category: categories.find(([pattern]) => pattern.test(message.slice(0, 4_096)))?.[1] ?? 'other',
      messageLength: message.length,
      stack: typeof rawStack === 'string' ? codeFrames(rawStack.slice(0, 16_000)) : [],
    };
  } catch {
    return { name: 'UnknownError', category: 'other', messageLength: 0, stack: [] };
  }
}
