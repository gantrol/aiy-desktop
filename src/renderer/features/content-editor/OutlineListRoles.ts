import { BulletList, OrderedList } from '@tiptap/extension-list';
import TaskList from '@tiptap/extension-task-list';

const outlineRole = {
  // Live editor JSON is validated before serialization, so absent roles must also be valid JSON.
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('data-outline-role') || null,
  renderHTML: (attributes: { outlineRole?: string | null }) =>
    attributes.outlineRole ? { 'data-outline-role': attributes.outlineRole } : {},
};

export const OutlineBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), outlineRole };
  },
});

export const OutlineOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), outlineRole };
  },
});

export const OutlineTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), outlineRole };
  },
});
