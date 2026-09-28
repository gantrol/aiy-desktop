import type { WorkErrorCode } from '@/shared/contracts/work-tracking';

export class WorkTrackingError extends Error {
  constructor(readonly code: WorkErrorCode) {
    super(code);
  }
}
