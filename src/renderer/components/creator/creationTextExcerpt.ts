import { contentMarkdownText } from '@/shared/content-markdown';
import type { CreationFormProjection } from '@/renderer/components/creator/creationLibraryProjection';

/** Reuse loaded content; bound parsing work instead of fetching each article for its list row. */
export function creationTextPreview(form: CreationFormProjection | null, title: string) {
  const body =
    form?.role === 'ARTICLE'
      ? form.entity && 'previewMarkdown' in form.entity
        ? form.entity.previewMarkdown
        : form.entity?.content.markdown
      : form?.role === 'SOCIAL_POST'
        ? form.entity?.content.body
        : undefined;
  if (!body) return {};
  const text = contentMarkdownText(body.slice(0, 2_000), () => '', { omitReferences: true });
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] === title.trim()) lines.shift();
  return {
    excerpt: Array.from(lines.join(' ').replace(/\s+/gu, ' ')).slice(0, 180).join(''),
    outlineLines:
      form?.role === 'ARTICLE' && form.entity?.content.editorMode === 'OUTLINE'
        ? lines.slice(0, 3).map((line) => Array.from(line).slice(0, 100).join(''))
        : undefined,
  };
}
