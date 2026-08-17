export interface FixturePackProfile {
  key: string;
  fixtureLibraryId: string;
  id: string;
  displayName: string;
  description: string;
  contentKinds: string[];
  defaultRoles: string[];
  includeInlineTerms: boolean;
  releaseVersion?: string;
}
