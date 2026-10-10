import { markdownBlockDocument } from '@/shared/block-document-codecs';
import type { ArticleContentInput } from '@/shared/contracts/article';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { creationReadingSchema, type ReadingLocation } from '@/shared/contracts/creation-reading';
import { readingCitationLink } from '@/shared/reading-citation-link';

export interface ReadingTextCitation {
  sourceId: string;
  location: ReadingLocation;
  label: string;
}

export function readingQuoteDocument(
  snapshot: ArticleContentInput,
  articleId: string,
  text: string,
  citation?: ReadingTextCitation,
) {
  if (text.length > 100_000 || snapshot.markdown.length + text.length + (citation?.label.length ?? 0) > 1_000_000)
    return null;
  const citationId = crypto.randomUUID();
  const reading = citation
    ? creationReadingSchema.safeParse({
        ...snapshot.reading,
        citations: [
          ...(snapshot.reading?.citations ?? []),
          { id: citationId, sourceId: citation.sourceId, location: citation.location, quote: text },
        ],
      })
    : null;
  if (reading && !reading.success) return null;
  const before = snapshot.document ?? markdownBlockDocument(snapshot.markdown, snapshot.mediaBindings);
  const paragraphs: NonNullable<BlockDocument['root']['content']> = text.split(/\r?\n/).map((line) => ({
    type: 'paragraph',
    attrs: { blockId: crypto.randomUUID() },
    ...(line ? { content: [{ type: 'text', text: line }] } : {}),
  }));
  if (citation)
    paragraphs.push({
      type: 'paragraph',
      attrs: { blockId: crypto.randomUUID() },
      content: [
        {
          type: 'text',
          text: citation.label,
          marks: [{ type: 'link', attrs: { href: readingCitationLink(articleId, citationId) } }],
        },
      ],
    });
  const next: BlockDocument = {
    ...before,
    root: { ...before.root, content: [...(before.root.content ?? []), ...paragraphs] },
  };
  return { before, next, reading: reading?.success ? reading.data : undefined };
}
