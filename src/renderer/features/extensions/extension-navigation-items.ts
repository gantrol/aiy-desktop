import { SlidersHorizontalIcon } from 'lucide-react';
import { CodexIcon } from '@/renderer/icons';
import type { AppNavigationItem } from '@/renderer/components/app/app-navigation-items';

/** Plugin shortcuts follow availability and opt-in state from their navigation hooks. */
export function getExtensionNavigationItems({
  codexImagesVisible,
  transitionShowcaseVisible,
}: {
  codexImagesVisible: boolean;
  transitionShowcaseVisible: boolean;
}): AppNavigationItem[] {
  const items: AppNavigationItem[] = [];
  if (codexImagesVisible) items.push({ id: 'codexImages', icon: CodexIcon, activeViews: ['codexImages'] });
  if (transitionShowcaseVisible)
    items.push({ id: 'transitionShowcase', icon: SlidersHorizontalIcon, activeViews: ['transitionShowcase'] });
  return items;
}
