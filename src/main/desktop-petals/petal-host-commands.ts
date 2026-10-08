import { z } from 'zod';
import type { PetalWindows, PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PendingPetalFlush } from '@/main/desktop-petals/petal-flush-request';
import { petalLanguageSchema, type PetalLanguage } from '@/shared/contracts/petal-language';
import { petalFlushReportSchema } from '@/shared/contracts/petal-workspace';
import { petalError } from '@/shared/petal-errors';
import { screen } from 'electron';
import { petalPointSchema } from '@/shared/contracts/desktop-petals';
import type { PetalDrag } from '@/main/desktop-petals/petal-window-drag';

interface Options {
  windows: PetalWindows;
  pending: Map<string, PendingPetalFlush>;
  language: PetalLanguage;
  setLanguage(language: PetalLanguage): void;
  presentation(command: string, input: unknown, entry?: PetalWindow): unknown;
  preview(input: unknown, entry?: PetalWindow): unknown;
}

/** Boot, acknowledgements and overlay release must work without an active space, including during drain. */
export async function executePetalHostCommand(
  deps: Options,
  senderId: number,
  entry: PetalWindow | undefined,
  command: string,
  input: unknown,
) {
  const handled = (value?: unknown) => ({ handled: true as const, value });
  if (command === 'rendered') {
    if (!entry) throw petalError('hubOnly');
    deps.windows.rendered(entry);
    return handled();
  }
  if (command === 'language') return handled(deps.language);
  if (command === 'set-language') {
    if (entry) throw new Error('Only the main UI can change the application language');
    const language = petalLanguageSchema.parse(input);
    deps.setLanguage(language);
    deps.windows.setLanguage(language);
    return handled();
  }
  if (command === 'flushed') {
    const result = z
      .object({ token: z.string(), saved: z.boolean(), report: petalFlushReportSchema.optional() })
      .strict()
      .parse(input);
    const pending = deps.pending.get(result.token);
    if (pending?.senderId === senderId) pending.finish(result.saved, result.report);
    return handled();
  }
  if (command === 'application-panel' && input === 0) return handled(entry ? deps.windows.notePanel.set(entry, 0) : 0);
  if (input && typeof input === 'object') {
    if (command === 'pluck-watch' && 'active' in input && input.active === false)
      return handled(await deps.presentation(command, input, entry));
    if ('open' in input && input.open === false) {
      if (command === 'menu-open') return handled(await deps.presentation(command, input, entry));
      if (command === 'preview') return handled(await deps.preview(input, entry));
    }
  }
  return { handled: false as const };
}

export function executePetalPresentation(
  windows: PetalWindows,
  dragging: Map<number, PetalDrag>,
  command: string,
  input: unknown,
  entry?: PetalWindow,
) {
  if (!entry) throw petalError('hubOnly');
  if (command === 'menu-open') {
    const request = z.object({ open: z.boolean(), point: petalPointSchema.optional() }).strict().parse(input);
    if (request.open && (entry.expanded || dragging.has(entry.window.webContents.id)))
      throw petalError('invalidSettings');
    windows.presentation.preview(entry, request.open, 'menu');
    return request.point ?? screen.getCursorScreenPoint();
  }
  if (entry.instanceId) throw petalError('hubOnly');
  if (command === 'pluck-watch') {
    const request = z.object({ token: z.string().uuid(), active: z.boolean() }).strict().parse(input);
    return windows.pluck.watch(entry, request.token, request.active);
  }
  if (command === 'pluck-position') {
    const request = z.object({ point: petalPointSchema, pointer: petalPointSchema.optional() }).strict().parse(input);
    return windows.presentation.pluckPosition(request.point, request.pointer);
  }
  const active = z.boolean().parse(input);
  if (command === 'pluck-preview') windows.presentation.preview(entry, active);
  else if (!dragging.has(entry.window.webContents.id)) windows.presentation.reveal(entry, active);
}
