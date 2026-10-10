import { blockDocumentText } from '@/shared/block-document-codecs';
import { blockDocumentSchema } from '@/shared/contracts/block-document';
import { contentDisplayTitle } from '@/shared/content-document';
import { contentMarkdownText } from '@/shared/content-markdown';

/** Optional recovery previews must never expose serialized editor state. */
export function storedContentPreview(serialized: unknown): { title: string; previewText: string | null } {
  const empty = { title: '', previewText: null };
  if (typeof serialized !== 'string') return empty;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
    const content = value as Record<string, unknown>;
    const document = blockDocumentSchema.safeParse(content.document);
    const body = document.success
      ? blockDocumentText(document.data)
      : ([content.markdown, content.body, content.manualPrompt, content.summary].find(
          (part): part is string => typeof part === 'string' && part.trim().length > 0,
        ) ?? '');
    const previewText =
      contentMarkdownText(body, () => '', { omitReferences: true })
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500) || null;
    return {
      title: contentDisplayTitle(typeof content.title === 'string' ? content.title : '', previewText ?? ''),
      previewText,
    };
  } catch {
    // Old snapshots may contain only the first 500 characters of the JSON.
    return empty;
  }
}
