import { clipboard } from 'electron';
import type { LibraryDatabase } from '@/main/database';
import type { ContentLibraryCommand } from '@/shared/contracts/content-library';
import { contentMarkdownText } from '@/shared/content-markdown';

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/gu,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

/** Only trusted IPC callers can copy a reference resolved from their active library. */
export function copyLibraryReference(
  database: LibraryDatabase,
  command: Extract<ContentLibraryCommand, { kind: 'reference-copy' }>,
) {
  const reference = database.contentLibrary.references([command.id])[0];
  if (!reference) throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
  const plain = contentMarkdownText(reference.markdown);
  const text = command.format === 'TEXT' ? plain : `${plain}\n\n${reference.title} · ${reference.revisionId}`;
  try {
    clipboard.write(
      command.format === 'TEXT'
        ? { text }
        : {
            text,
            html: `<div data-aiy-reference="${escapeHtml(reference.id)}"><pre>${escapeHtml(text)}</pre></div>`,
          },
    );
  } catch (cause) {
    console.error('[content-reference] clipboard write failed', cause);
    throw new Error('REFERENCE_COPY_FAILED', { cause });
  }
}
