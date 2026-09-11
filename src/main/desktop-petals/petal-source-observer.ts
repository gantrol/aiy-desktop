import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';

const pinSourceEntities = new Set([
  'ARTICLE',
  'SOCIAL_POST',
  'IMAGE_ASSET',
  'MATERIAL',
  'CREATION_ITEM',
  'ALBUM',
  'ALBUM_MEMBER',
  'INSPIRATION_STASH',
  'PROMPT_SERIES',
  'GENERATION_RUN',
  'CREATION_OUTPUT_IMPORT',
  'IMAGE_TRANSFORM',
  'GENERATION_OUTPUT_REVIEW',
  'DOCUMENT',
  'DERIVED_VISUAL',
  'CREATION_FORM',
]);

/** Album previews also depend on membership, creation covers and descendant content. */
export function observePetalPins(context: ActiveLibraryContext, current: () => boolean, reconcile: () => void) {
  return context.database.subscribeContentChanges((changes) => {
    if (current() && context.state === 'ACTIVE' && changes.some((change) => pinSourceEntities.has(change.entityType)))
      reconcile();
  });
}

/** The projection observes library invalidation; content lifecycle operations know nothing about windows. */
export function observePetalSources(
  context: ActiveLibraryContext,
  current: () => boolean,
  openInstances: () => readonly string[],
  remove: (instanceId: string) => void,
  changed: (removed: boolean) => void,
) {
  return context.database.subscribeContentChanges((changes) => {
    if (!current() || context.state !== 'ACTIVE') return;
    const sources = changes.filter((change) => change.entityType === 'ARTICLE').map((change) => change.entityId);
    if (!sources.length) {
      if (changes.some((change) => change.entityType === 'ARTICLE_COMMENT')) changed(false);
      return;
    }
    const unavailable = new Set<string>();
    for (let start = 0; start < sources.length; start += 100)
      for (const id of context.database.reconcileDesktopNoteSources(sources.slice(start, start + 100)))
        unavailable.add(id);
    const active = new Set(context.database.listDesktopNoteIds());
    for (const id of openInstances()) if (!active.has(id)) unavailable.add(id);
    for (const id of unavailable) remove(id);
    changed(unavailable.size > 0);
  });
}
