import {
  ActivityIcon,
  BookOpenIcon,
  CalendarIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  ImagesIcon,
  ListTreeIcon,
  PanelsTopLeftIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  VideoIcon,
} from 'lucide-react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

export function workspaceTabIcon(location: AppLocation) {
  switch (location.view) {
    case 'creator':
      switch (location.creator.surface) {
        case 'outline':
          return ListTreeIcon;
        case 'article':
        case 'social-post':
          return FileTextIcon;
        case 'album-detail':
          return FolderIcon;
        case 'existing-creation':
        case 'image-breakdown':
          return ImagesIcon;
        case 'animation':
          return VideoIcon;
        default:
          return SquarePenIcon;
      }
    case 'gallery':
      return ImagesIcon;
    case 'dictionary':
      return BookOpenIcon;
    case 'documents':
      return VideoIcon;
    case 'search':
      return SearchIcon;
    case 'calendar':
      return CalendarIcon;
    case 'companion':
      return GlobeIcon;
    case 'packs':
      return PuzzleIcon;
    case 'settings':
    case 'contentManagement':
      return SettingsIcon;
    case 'aiCenter':
      return ActivityIcon;
    default:
      return PanelsTopLeftIcon;
  }
}
