/**
 * Selector contract for the end-to-end lane.
 *
 * The product already annotates its shell with `data-view`, `data-action`, and
 * entity-id attributes — `src/main/development/capture.ts` drives the app
 * through exactly these. Naming them once here gives the E2E lane a stable
 * surface and keeps CSS refactors from breaking journeys.
 *
 * `tests/e2e-selector-contract.architecture.test.ts` asserts every name below
 * still exists in the renderer, so drift is caught at unit-lane speed instead of
 * as a later E2E timeout. That test already found four
 * names in the capture script that no longer exist in any component.
 */
export const view = (name: ViewName) => `[data-view="${name}"]`;
export const action = (name: ActionName) => `[data-action="${name}"]`;
export const albumById = (albumId: string) => `[data-album-id="${albumId}"]`;
export const extensionById = (extensionId: string) => `[data-extension-id="${extensionId}"]`;

/** Sidebar navigation targets, from the `items` array in `AppSidebar.tsx`. */
export const views = {
  creator: 'creator',
  dictionary: 'dictionary',
  gallery: 'gallery',
  packs: 'packs',
  aiCenter: 'aiCenter',
} as const;

/** Controls the journeys drive. Every value is a literal in renderer markup. */
export const actions = {
  newCreation: 'new-creation',
  saveCreationV01: 'save-creation-v01',
  generate: 'generate',
  cancelGeneration: 'cancel-generation',
  retryGeneration: 'retry-generation',
  generationSettings: 'generation-settings',
  modelTargetSelector: 'model-target-selector',
  backgroundTasks: 'background-tasks',
  dictionaryNew: 'dictionary-new',
  dictionaryNewSubmit: 'dictionary-new-submit',
  dictionarySearch: 'dictionary-search',
  dictionaryFilter: 'dictionary-filter',
  dictionaryMaintenance: 'dictionary-maintenance',
  dictionaryMaintenanceRefresh: 'dictionary-maintenance-refresh',
  dictionaryMaintenanceOpenTerm: 'dictionary-maintenance-open-term',
  dictionaryClassifications: 'dictionary-classifications',
  classificationSelect: 'classification-select',
  classificationNewTerm: 'classification-new-term',
  classificationNewRoot: 'classification-new-root',
  classificationNewChild: 'classification-new-child',
  classificationSubmit: 'classification-submit',
  dictionaryImport: 'dictionary-import',
  dictionaryImportCommit: 'dictionary-import-commit',
  dictionaryPicker: 'dictionary-picker',
  creatorReferenceSearch: 'creator-reference-search',
  dictionaryContextBack: 'dictionary-context-back',
  openTerm: 'open-term',
  termDetailEdit: 'term-detail-edit',
  termDetailBack: 'term-detail-back',
  termMediaAdd: 'term-media-add',
  termMediaPickerAdd: 'term-media-picker-add',
  termMediaPickerImport: 'term-media-picker-import',
  termAddExpression: 'term-add-expression',
  termAddLocalization: 'term-add-localization',
  termSave: 'term-save',
  termApprove: 'term-approve',
  termStateActions: 'term-state-actions',
  termWithdraw: 'term-withdraw',
  termArchive: 'term-archive',
  termArchiveConfirm: 'term-archive-confirm',
  termRestore: 'term-restore',
  renameSeries: 'rename-series',
  renameSeriesSubmit: 'rename-series-submit',
  deleteEntityConfirm: 'delete-entity-confirm',
  settings: 'settings',
  localSpaceSwitcher: 'local-space-switcher',
  outputGenerationRecord: 'output-generation-record',
  imageTransformOpen: 'image-transform-open',
  imageTransformSubmit: 'image-transform-submit',
  codexImagesImport: 'codex-images-import',
  intakeFileInput: 'intake-file-input',
  intakeChooseImages: 'intake-choose-images',
  intakeImport: 'intake-import',
  intakeStartCreation: 'intake-start-creation',
  intakeCancel: 'intake-cancel',
  starterPackKeepEmpty: 'starter-pack-keep-empty',
  materialAll: 'material-all',
  materialSearch: 'material-search',
  materialClearSearch: 'material-clear-search',
  materialScopeFavorite: 'material-scope-favorite',
  materialGridView: 'material-grid-view',
  materialListView: 'material-list-view',
  materialSelectionMode: 'material-selection-mode',
  materialBatchAdd: 'material-batch-add',
  materialBatchClear: 'material-batch-clear',
  materialBatchDestinationAlbum: 'material-batch-destination-album',
  materialBatchDestinationTerm: 'material-batch-destination-term',
  materialBatchConfirm: 'material-batch-confirm',
  materialBatchCreateAlbum: 'material-batch-create-album',
  materialCreateAlbum: 'material-create-album',
  materialOpenAlbum: 'material-open-album',
  materialAlbumSubmit: 'material-album-submit',
  materialAlbumDeleteConfirm: 'material-album-delete-confirm',
  materialAlbumMembership: 'material-album-membership',
  materialInspectorClose: 'material-inspector-close',
  materialInspectorRelationships: 'material-inspector-relationships',
  materialInspectorDetails: 'material-inspector-details',
  materialInspectorRating: 'material-inspector-rating',
  materialFavoriteToggle: 'material-favorite-toggle',
  materialMetadataSave: 'material-metadata-save',
  assetFileCopy: 'asset-file-copy',
} as const;

export type ViewName = (typeof views)[keyof typeof views];
export type ActionName = (typeof actions)[keyof typeof actions];

/** The sidebar marks the current view with `aria-current="page"`. */
export const activeView = (name: ViewName) => `${view(name)}[aria-current="page"]`;
