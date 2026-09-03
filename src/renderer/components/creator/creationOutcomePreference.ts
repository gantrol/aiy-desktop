import type { CreationOutcomePlan } from '@/renderer/components/creator/CreationOutcomePicker';

type RememberedCreationOutcomeKind = CreationOutcomePlan['kind'];

const CREATION_OUTCOME_KIND_STORAGE_KEY = 'aiy.creation-outcome-kind.v1';

function isRememberedCreationOutcomeKind(value: unknown): value is RememberedCreationOutcomeKind {
  return value === 'image' || value === 'social-post' || value === 'article';
}

export function readCreationOutcomeKind(): RememberedCreationOutcomeKind {
  try {
    const stored = globalThis.localStorage?.getItem(CREATION_OUTCOME_KIND_STORAGE_KEY);
    return isRememberedCreationOutcomeKind(stored) ? stored : 'image';
  } catch {
    return 'image';
  }
}

export function writeCreationOutcomeKind(kind: RememberedCreationOutcomeKind) {
  try {
    globalThis.localStorage?.setItem(CREATION_OUTCOME_KIND_STORAGE_KEY, kind);
  } catch {
    // The current selection remains usable when renderer storage is unavailable.
  }
}
