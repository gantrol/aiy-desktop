import {
  browserCompanionWatermarkSelectionSchema,
  type BrowserCompanionWatermarkSelection,
} from '@/shared/contracts/browser-companion';

const WATERMARK_SELECTION_STORAGE_KEY = 'aiy.browser-companion.watermark-selection.v1';

export function readBrowserCompanionWatermarkSelection(): BrowserCompanionWatermarkSelection {
  try {
    const stored = globalThis.localStorage?.getItem(WATERMARK_SELECTION_STORAGE_KEY);
    const selection = browserCompanionWatermarkSelectionSchema.safeParse(JSON.parse(stored ?? 'null'));
    return selection.success ? selection.data : { kind: 'NONE' };
  } catch {
    return { kind: 'NONE' };
  }
}

export function writeBrowserCompanionWatermarkSelection(selection: BrowserCompanionWatermarkSelection) {
  try {
    globalThis.localStorage?.setItem(WATERMARK_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // The current selection remains usable when renderer storage is unavailable.
  }
}
