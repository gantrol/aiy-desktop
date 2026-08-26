import type { BootstrapDto, Locale, NavigationCommand } from '@/shared/contracts';
import { resolveTermTitle } from '@/shared/term-localization';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

// These are logical XButton inputs delivered by Chromium after mouse-driver remapping, not raw physical-button reads; keep the mapping explicit so it can become user-configurable.
export const DEFAULT_MOUSE_NAVIGATION_BINDINGS = new Map<number, NavigationCommand>([
  [3, 'back'],
  [4, 'forward'],
]);

export const appGridRows = (fullWindow: boolean) =>
  fullWindow ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[36px_minmax(0,1fr)]';

export function appMaterialsReturnSummary(
  context: AppLocation['materialsReturnContext'],
  data: BootstrapDto | null,
  locale: Locale,
) {
  if (context?.destination === 'creator') {
    return data?.series.find((item) => item.id === context.seriesId)?.title ?? '';
  }
  if (context?.destination === 'dictionary') {
    const term = data?.terms.find((item) => item.id === context.termId);
    return term ? resolveTermTitle(term, locale) : '';
  }
  return context?.destination === 'documents' ? context.title : '';
}
