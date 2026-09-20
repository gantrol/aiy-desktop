import type { ContentReference } from '@/shared/contracts/content-library';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';

/** Standard HTML carries the reference in AIY; other applications receive readable text and provenance. */
export async function copyContentReference(reference: ContentReference, format: 'REFERENCE' | 'TEXT' = 'REFERENCE') {
  await contentLibraryApi().referenceCopy(reference.id, format);
}
