import { OutlineEditing } from '@/renderer/features/content-editor/outlineEditing';
import { OutlineListItem } from '@/renderer/features/content-editor/OutlineListItem';
import {
  OutlineBulletList,
  OutlineOrderedList,
  OutlineTaskList,
} from '@/renderer/features/content-editor/OutlineListRoles';

export function outlineExtensions(preferenceKey?: string) {
  return [
    OutlineEditing.configure({ preferenceKey: preferenceKey ?? null }),
    OutlineListItem,
    OutlineBulletList,
    OutlineOrderedList,
    OutlineTaskList,
  ];
}
