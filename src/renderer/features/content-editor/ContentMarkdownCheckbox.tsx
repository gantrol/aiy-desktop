import type { Components } from 'react-markdown';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { useI18n } from '@/renderer/i18n/useI18n';

/** Markdown previews display the saved state; only the editor changes it. */
export const ContentMarkdownCheckbox: Components['input'] = ({ type, checked }) => {
  const label = useI18n().messages.videoDocuments.editor.richText.taskList;
  return type === 'checkbox' ? <Checkbox checked={Boolean(checked)} disabled aria-label={label} /> : null;
};
