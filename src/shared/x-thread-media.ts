export const X_POST_MEDIA_LIMIT = 4;
export const X_HANDOFF_MEDIA_LIMIT = 20;

/** Keep text intact and add media-only posts when attachments outnumber text posts. */
export function xThreadWithMedia(posts: string[] | null, mediaCount: number): string[] | null {
  if (!posts || !Number.isInteger(mediaCount) || mediaCount < 0 || mediaCount > X_HANDOFF_MEDIA_LIMIT) return null;
  return Array.from(
    { length: Math.max(posts.length, Math.ceil(mediaCount / X_POST_MEDIA_LIMIT)) },
    (_, index) => posts[index] ?? '',
  );
}
