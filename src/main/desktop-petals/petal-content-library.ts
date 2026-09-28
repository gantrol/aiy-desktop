import { shell } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { copyLibraryReference } from '@/main/creations/content-reference-clipboard';
import { linkPreviews, openLinkCard } from '@/main/links/link-preview-service';
import { contentLibraryCommandSchema } from '@/shared/contracts/content-library';
import { petalError } from '@/shared/petal-errors';

/** Keep the petal host's content permissions separate from window presentation. */
export async function executePetalContentLibrary(input: unknown, context: ActiveLibraryContext) {
  const request = contentLibraryCommandSchema.parse(input);
  if (request.kind === 'agent-link') throw new Error('AIY_AGENT_CONTENT_UNSUPPORTED_HOST');
  if (request.kind === 'reference-copy') return copyLibraryReference(context.database, request);
  if (request.kind === 'link-preview') return linkPreviews.get(request.url, request.refresh);
  if (request.kind === 'link-open') return openLinkCard(request.url);
  if (request.kind.startsWith('note-')) throw petalError('sourceUnavailable');
  if (request.kind === 'reveal') {
    const error = await shell.openPath(await context.database.ensureContentDirectory(request.source));
    if (error) throw new Error(error);
    return;
  }
  return context.database.executeContentLibrary(request);
}
