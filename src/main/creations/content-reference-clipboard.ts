import { clipboard } from 'electron';
import type { LibraryDatabase } from '@/main/database';
import type { ContentLibraryCommand } from '@/shared/contracts/content-library';
import { contentMarkdownText } from '@/shared/content-markdown';
import { presentReferenceMarkdown } from '@/shared/content-reference-presentation';

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
  const resolved = database.contentLibrary.resolveReferences([command.id])[0];
  if (resolved?.state === 'UNAVAILABLE') throw new Error('REFERENCE_FOLLOW_UNAVAILABLE');
  const reference = resolved?.reference;
  if (!reference) throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
  if (
    (command.expectedRevisionId && command.expectedRevisionId !== reference.revisionId) ||
    (command.expectedContentHash && command.expectedContentHash !== reference.contentHash)
  )
    throw new Error('REFERENCE_TARGET_CHANGED');
  const plain = contentMarkdownText(presentReferenceMarkdown(reference, command.presentation, command.parentLevel));
  const text = command.format === 'TEXT' ? plain : `${plain}\n\n${reference.title} · ${reference.revisionId}`;
  try {
    clipboard.write(
      command.format === 'TEXT'
        ? { text }
        : {
            text,
            html: `<div data-aiy-reference="${escapeHtml(reference.id)}"${reference.spaceId ? ` data-aiy-reference-space="${escapeHtml(reference.spaceId)}"` : ''}${command.presentation ? ` data-aiy-reference-presentation="${escapeHtml(JSON.stringify(command.presentation))}"` : ''}${command.editing ? ` data-aiy-reference-editing="${command.editing}"` : ''}><pre>${escapeHtml(text)}</pre></div>`,
          },
    );
  } catch (cause) {
    console.error('[content-reference] clipboard write failed', cause);
    throw new Error('REFERENCE_COPY_FAILED', { cause });
  }
}
