import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';

type ErrorCode =
  | 'sourceUnavailable'
  | 'emptyNote'
  | 'structuredNote'
  | 'saving'
  | 'libraryUnavailable'
  | 'wrongLibrary'
  | 'hubOnly'
  | 'unsaved'
  | 'pauseTimer'
  | 'invalidTimeZone'
  | 'invalidSettings'
  | 'pinLimit'
  | 'layerLimit'
  | 'fileLimit';

export type PetalCommandResult = { ok: true; value: unknown } | { ok: false; code: ErrorCode };

export class PetalError extends Error {
  constructor(readonly code: ErrorCode) {
    super(`[aiy-petal:${code}]`);
  }
}

export function petalError(code: ErrorCode) {
  return new PetalError(code);
}

export function petalErrorCode(error: unknown) {
  return /\[aiy-petal:([A-Za-z]+)\]/.exec(String(error))?.[1];
}

/** Resolve stable IPC error markers at presentation time; never display raw validation JSON. */
export function petalErrorText(error: unknown, messages: DesktopPetalMessages['errors']) {
  const raw = String(error);
  const key = petalErrorCode(error);
  if (key && Object.hasOwn(messages, key)) return messages[key as keyof typeof messages];
  if (/invalid_value|invalid_type|unrecognized_keys|too_small|too_big/.test(raw)) return messages.invalidSettings;
  return messages.operationFailed;
}
