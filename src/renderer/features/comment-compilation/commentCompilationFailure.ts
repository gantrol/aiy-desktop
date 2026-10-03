import type { CommentCompilationState } from '@/renderer/features/comment-compilation/commentCompilationState';

export function commentCompilationFailure(reason: unknown): CommentCompilationState['error'] {
  const message = String(reason);
  if (message.includes('COMMENT_COMPILATION_REQUEST_REUSED')) return 'invalid';
  if (/COMMENT_COMPILATION_(SOURCE_CHANGED|COMMENTS_CHANGED)/u.test(message)) return 'changed';
  if (message.includes('COMMENT_COMPILATION_TOO_LARGE')) return 'tooLarge';
  if (message.includes('COMMENT_COMPILATION_EMPTY')) return 'empty';
  if (
    /CONTENT_LIBRARY_SPACE_CHANGED|COMMENT_COMPILATION_RESULT_UNAVAILABLE|REFERENCE_SOURCE_UNAVAILABLE/u.test(message)
  )
    return 'unavailable';
  return 'failed';
}
