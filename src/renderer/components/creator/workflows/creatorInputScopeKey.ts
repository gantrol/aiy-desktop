interface CreatorInputScope {
  libraryKey: string;
  sessionGeneration: number;
  inputSessionRevision: number;
  creationMode: 'new' | 'existing';
  seriesId: string | null;
  versionId: string | null;
}

/** Persisting a new draft assigns its ID without changing the input session. */
export function creatorInputScopeKey(scope: CreatorInputScope) {
  return JSON.stringify([
    scope.libraryKey,
    scope.sessionGeneration,
    scope.inputSessionRevision,
    scope.creationMode,
    ...(scope.creationMode === 'existing' ? [scope.seriesId, scope.versionId] : []),
  ]);
}
