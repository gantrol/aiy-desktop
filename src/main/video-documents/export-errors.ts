export type VideoDocumentExportErrorCode =
  | 'VIDEO_DOCUMENT_EXPORT_BRANCH_UNSUPPORTED'
  | 'VIDEO_DOCUMENT_EXPORT_DOCUMENT_CHANGED'
  | 'VIDEO_DOCUMENT_EXPORT_EXTENSION_INVALID'
  | 'VIDEO_DOCUMENT_EXPORT_MEDIA_UNAVAILABLE'
  | 'VIDEO_DOCUMENT_EXPORT_IMAGE_TOO_LARGE'
  | 'VIDEO_DOCUMENT_EXPORT_TOO_LARGE'
  | 'VIDEO_DOCUMENT_EXPORT_FILE_IN_USE'
  | 'VIDEO_DOCUMENT_EXPORT_PERMISSION_DENIED'
  | 'VIDEO_DOCUMENT_EXPORT_PATH_INVALID'
  | 'VIDEO_DOCUMENT_EXPORT_DOCX_BUILD_FAILED'
  | 'VIDEO_DOCUMENT_EXPORT_DOCX_INVALID'
  | 'VIDEO_DOCUMENT_EXPORT_FAILED';

export class VideoDocumentExportError extends Error {
  readonly code: VideoDocumentExportErrorCode;
  readonly retryable: boolean;
  readonly targetPath: string | null;

  constructor(
    code: VideoDocumentExportErrorCode,
    options: { cause?: unknown; retryable?: boolean; targetPath?: string | null } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'VideoDocumentExportError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.targetPath = options.targetPath ?? null;
  }
}

export function exportError(
  code: VideoDocumentExportErrorCode,
  options: { cause?: unknown; retryable?: boolean; targetPath?: string | null } = {},
) {
  return new VideoDocumentExportError(code, options);
}

export function normalizeVideoDocumentExportError(
  error: unknown,
  context: 'GENERAL' | 'DESTINATION_REPLACE' | 'SOURCE_MEDIA' = 'GENERAL',
  targetPath: string | null = null,
) {
  if (error instanceof VideoDocumentExportError) {
    return targetPath && !error.targetPath
      ? exportError(error.code, { cause: error, retryable: error.retryable, targetPath })
      : error;
  }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (context === 'DESTINATION_REPLACE' && (code === 'EBUSY' || code === 'ETXTBSY' || code === 'EPERM')) {
    return exportError('VIDEO_DOCUMENT_EXPORT_FILE_IN_USE', { cause: error, retryable: true, targetPath });
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return exportError('VIDEO_DOCUMENT_EXPORT_PERMISSION_DENIED', { cause: error, retryable: true, targetPath });
  }
  if (context === 'SOURCE_MEDIA' && code === 'ENOENT') {
    return exportError('VIDEO_DOCUMENT_EXPORT_MEDIA_UNAVAILABLE', { cause: error, targetPath });
  }
  if (
    code === 'ENOENT' ||
    code === 'ENOTDIR' ||
    code === 'EISDIR' ||
    code === 'EINVAL' ||
    code === 'ENAMETOOLONG' ||
    code === 'EEXIST'
  ) {
    return exportError('VIDEO_DOCUMENT_EXPORT_PATH_INVALID', { cause: error, retryable: true, targetPath });
  }
  return exportError('VIDEO_DOCUMENT_EXPORT_FAILED', { cause: error, targetPath });
}

export type VideoDocumentExportFailureCode =
  | 'FILE_IN_USE'
  | 'PERMISSION_DENIED'
  | 'PATH_INVALID'
  | 'MEDIA_MISSING'
  | 'DOCUMENT_CHANGED'
  | 'DOCX_BUILD_FAILED'
  | 'WRITE_FAILED';

export interface VideoDocumentExportFailure {
  code: VideoDocumentExportFailureCode;
  retryable: boolean;
  targetPath: string | null;
  diagnostic: string | null;
}

function publicFailureCode(code: VideoDocumentExportErrorCode): VideoDocumentExportFailureCode {
  if (code === 'VIDEO_DOCUMENT_EXPORT_FILE_IN_USE') return 'FILE_IN_USE';
  if (code === 'VIDEO_DOCUMENT_EXPORT_PERMISSION_DENIED') return 'PERMISSION_DENIED';
  if (code === 'VIDEO_DOCUMENT_EXPORT_PATH_INVALID' || code === 'VIDEO_DOCUMENT_EXPORT_EXTENSION_INVALID') {
    return 'PATH_INVALID';
  }
  if (code === 'VIDEO_DOCUMENT_EXPORT_MEDIA_UNAVAILABLE') return 'MEDIA_MISSING';
  if (code === 'VIDEO_DOCUMENT_EXPORT_DOCUMENT_CHANGED') return 'DOCUMENT_CHANGED';
  if (
    code === 'VIDEO_DOCUMENT_EXPORT_DOCX_BUILD_FAILED' ||
    code === 'VIDEO_DOCUMENT_EXPORT_DOCX_INVALID' ||
    code === 'VIDEO_DOCUMENT_EXPORT_IMAGE_TOO_LARGE' ||
    code === 'VIDEO_DOCUMENT_EXPORT_TOO_LARGE'
  ) {
    return 'DOCX_BUILD_FAILED';
  }
  return 'WRITE_FAILED';
}

export function videoDocumentExportFailure(error: unknown): VideoDocumentExportFailure {
  const normalized = normalizeVideoDocumentExportError(error);
  const cause = normalized.cause;
  const diagnostic = cause instanceof Error && cause.message ? cause.message.slice(0, 2_000) : null;
  return {
    code: publicFailureCode(normalized.code),
    retryable: normalized.retryable,
    targetPath: normalized.targetPath,
    diagnostic,
  };
}
