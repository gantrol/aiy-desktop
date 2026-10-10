const prefix = '#aiy-reading:';

export interface ReadingCitationLink {
  articleId: string;
  citationId: string;
}

// Document-local fragments survive Markdown export without granting a system URL capability.
export function readingCitationLink(articleId: string, citationId: string) {
  return `${prefix}${encodeURIComponent(articleId)}/${encodeURIComponent(citationId)}`;
}

export function parseReadingCitationLink(href: string): ReadingCitationLink | null {
  if (!href.startsWith(prefix) || href.length > 2500) return null;
  try {
    const parts = href.slice(prefix.length).split('/').map(decodeURIComponent);
    if (parts.length !== 2 || parts.some((part) => !part || part.length > 200 || /[\u0000-\u001f\u007f]/u.test(part)))
      return null;
    return { articleId: parts[0], citationId: parts[1] };
  } catch {
    return null;
  }
}
