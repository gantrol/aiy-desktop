import type { ContentSource } from '@/shared/contracts/content-library';

export class ContentReadError extends Error {
  constructor(
    readonly code: 'REVISION_UNAVAILABLE' | 'CURRENT_REVISION_UNAVAILABLE' | 'BRANCH_UNAVAILABLE' | 'NOTE_UNAVAILABLE',
    readonly source: ContentSource,
    readonly currentRevisionId: string | null = null,
  ) {
    super(code);
    this.name = 'ContentReadError';
  }
}
