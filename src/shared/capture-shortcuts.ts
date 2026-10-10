import { z } from 'zod';

export function normalizeCaptureShortcut(value: string, platform: string) {
  const parts = value
    .replace('CommandOrControl', platform === 'darwin' ? 'Command' : 'Control')
    .replace('Super', 'Command')
    .split('+');
  const key = parts.pop();
  return [...parts.sort(), key].join('+');
}

export const captureShortcutSchema = z
  .string()
  .max(80)
  .refine((value) => {
    if (!value) return true;
    const parts = value.split('+');
    const key = parts.pop()!;
    return (
      parts.every((part) => ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Super', 'Command'].includes(part)) &&
      new Set(parts).size === parts.length &&
      /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|PrintScreen)$/u.test(key) &&
      (parts.some((part) => part !== 'Shift') || /^(?:F\d+|PrintScreen)$/u.test(key))
    );
  });

export function captureShortcutFromKey(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
) {
  const key = event.code.replace(/^(Key|Digit)/u, '');
  const value = [
    event.ctrlKey && 'Control',
    event.metaKey && 'Super',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    key,
  ]
    .filter(Boolean)
    .join('+');
  return captureShortcutSchema.safeParse(value).success ? value : null;
}
