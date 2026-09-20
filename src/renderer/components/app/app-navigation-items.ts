import type { ComponentType } from 'react';
import { ActivityIcon, BlocksIcon, CalendarDaysIcon, ImagesIcon, SearchIcon, SquarePenIcon } from 'lucide-react';
import type { AppView } from '@/renderer/components/app/app-navigation';
import { DictionaryIcon } from '@/renderer/icons';

export interface AppNavigationItem {
  id: Exclude<AppView, 'documents' | 'companion' | 'contentManagement'>;
  icon: ComponentType<{ className?: string }>;
  activeViews: readonly AppView[];
}

type CoreNavigationItem = AppNavigationItem & {
  id: Exclude<AppNavigationItem['id'], 'codexImages' | 'transitionShowcase'>;
};

/** Shared by the navigation rail and app menu; labels resolve through app.navigation. */
export const navigationItems: readonly CoreNavigationItem[] = [
  { id: 'creator', icon: SquarePenIcon, activeViews: ['creator', 'documents'] },
  { id: 'dictionary', icon: DictionaryIcon, activeViews: ['dictionary'] },
  { id: 'gallery', icon: ImagesIcon, activeViews: ['gallery'] },
  { id: 'search', icon: SearchIcon, activeViews: ['search'] },
  { id: 'calendar', icon: CalendarDaysIcon, activeViews: ['calendar'] },
  { id: 'packs', icon: BlocksIcon, activeViews: ['packs'] },
  { id: 'aiCenter', icon: ActivityIcon, activeViews: ['aiCenter'] },
];
