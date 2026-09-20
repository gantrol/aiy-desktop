import type { ContentLibraryApi } from '@/shared/contracts/content-library';

/** Host selection stays at the edge; search and reference widgets share one typed client. */
export function contentLibraryApi(): ContentLibraryApi {
  const api = window.desktopApi?.contentLibrary ?? window.desktopPetals?.contentLibrary;
  if (!api) throw new Error('CONTENT_LIBRARY_UNAVAILABLE');
  return api;
}
