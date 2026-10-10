import type { ExtensionDto } from '@/shared/contracts';
import { CLIPBOARD_CAPTURE_ID, CLIPBOARD_HISTORY_ID } from '@/shared/contracts/clipboard-capture';
import { EMBEDDED_WEB_EXTENSION_ID } from '@/shared/contracts/embedded-web';
import {
  MAINTENANCE_GUIDE_EXTENSION_ID,
  NATURAL_WATERMARK_EXTENSION_ID,
  SCREEN_MAGNIFIER_EXTENSION_ID,
} from '@/shared/extension-ids';

/** Directory membership is owned by AIY, never by a package name or category. */
export const BUILTIN_TOOL_RUNTIMES: Readonly<Record<string, string>> = {
  [CLIPBOARD_CAPTURE_ID]: 'clipboard-capture',
  [CLIPBOARD_HISTORY_ID]: 'clipboard-history',
  [NATURAL_WATERMARK_EXTENSION_ID]: 'natural-watermark',
  [MAINTENANCE_GUIDE_EXTENSION_ID]: 'maintenance-guide',
  [EMBEDDED_WEB_EXTENSION_ID]: 'embedded-web',
  [SCREEN_MAGNIFIER_EXTENSION_ID]: 'screen-magnifier',
};

export function isBuiltinToolExtension({ manifest, source }: Pick<ExtensionDto, 'manifest' | 'source'>) {
  return (
    source === 'BUILT_IN' &&
    manifest.kind === 'CAPABILITY' &&
    Object.hasOwn(BUILTIN_TOOL_RUNTIMES, manifest.id) &&
    manifest.runtime?.kind === 'HOST' &&
    manifest.runtime.id === BUILTIN_TOOL_RUNTIMES[manifest.id]
  );
}
