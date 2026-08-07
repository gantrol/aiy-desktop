import type { IntakeCommitIntent } from '@/shared/contracts';

export type IntakeContext = 'LIBRARY_START' | 'GLOBAL_NEW' | 'GALLERY';

export interface IntakeContextPolicy {
  defaultIntent: IntakeCommitIntent;
  secondaryIntent: IntakeCommitIntent;
  /** Whether the favorite modifier starts on for this surface. */
  defaultFavorite: boolean;
}

// Every context can both import and start a creation; only the emphasis differs.
// Favoriting is never forced — it is a modifier the user opts into.
const policies: Record<IntakeContext, IntakeContextPolicy> = {
  LIBRARY_START: { defaultIntent: 'START_CREATION', secondaryIntent: 'IMPORT', defaultFavorite: false },
  GLOBAL_NEW: { defaultIntent: 'START_CREATION', secondaryIntent: 'IMPORT', defaultFavorite: false },
  GALLERY: { defaultIntent: 'IMPORT', secondaryIntent: 'START_CREATION', defaultFavorite: false },
};

export function intakeContextPolicy(context: IntakeContext): IntakeContextPolicy {
  return policies[context];
}
