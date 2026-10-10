import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { captureSelectionMessages, type CaptureSelectionMessages } from '@/shared/i18n/capture-selection';

/** Resolve the same installed language resource used by the renderer. */
export function captureLanguage(context: ActiveLibraryContext | null, locale: string): CaptureSelectionMessages {
  const pack = context?.extensions.listLanguagePacks().find((item) => item.locale === locale);
  const section = pack?.messages.clipboardCapture as Record<string, unknown> | undefined;
  const translated = section?.selection as Record<string, unknown> | undefined;
  const messages: CaptureSelectionMessages = { ...captureSelectionMessages };
  for (const key of Object.keys(messages) as (keyof CaptureSelectionMessages)[]) {
    const value = translated?.[key];
    if (typeof value === 'string' && value.length <= 6000) messages[key] = value;
  }
  return messages;
}
