import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { TermIllustrationRepository } from '@/main/database/dictionary/term-illustration-repository';
import type { JsonMap } from '@/main/database/core/values';
import type {
  AddTermMediaInput,
  CreateWordPaletteInput,
  DictionaryClassificationCreateInput,
  DictionaryClassificationMergeInput,
  DictionaryClassificationMoveInput,
  DictionaryClassificationReorderInput,
  DictionaryClassificationRestoreSourceInput,
  DictionaryClassificationSetStateInput,
  DictionaryClassificationTermsInput,
  DictionaryClassificationUpdateInput,
  DictionaryPageInput,
  DictionarySearchInput,
  Locale,
  NewTermInput,
  ReorderTermMediaInput,
  TermDraftInput,
  TermIllustrationAdoptInput,
  TermIllustrationListInput,
  TermListItem,
  UpdateWordPaletteInput,
} from '@/shared/contracts';

export function createDictionaryApi(
  repositories: Pick<
    LibraryDatabaseRepositories,
    'dictionary' | 'dictionaryClassifications' | 'imports' | 'termIllustrations'
  >,
) {
  return {
    getFacets(locale: Locale) {
      return repositories.dictionary.getFacets(locale);
    },

    getCategories(locale: Locale) {
      return repositories.dictionary.getCategories(locale);
    },

    getWordPalettes(locale: Locale, sourceTerms?: TermListItem[]) {
      return repositories.dictionary.getWordPalettes(locale, sourceTerms);
    },

    createWordPalette(input: CreateWordPaletteInput) {
      return repositories.dictionary.createWordPalette(input);
    },

    updateWordPalette(input: UpdateWordPaletteInput) {
      return repositories.dictionary.updateWordPalette(input);
    },

    setWordPaletteArchived(paletteId: string, archived: boolean) {
      return repositories.dictionary.setWordPaletteArchived(paletteId, archived);
    },

    deleteWordPalette(paletteId: string) {
      return repositories.dictionary.deleteWordPalette(paletteId);
    },

    searchTerms(
      locale: Locale,
      query = '',
      facetValueIds: string[] = [],
      filters?: Pick<DictionarySearchInput, 'excludeDrafts' | 'excludeUncited'> &
        Partial<
          Pick<DictionarySearchInput, 'includeArchived' | 'termIds' | 'classificationIds' | 'missingClassification'>
        >,
    ) {
      return repositories.dictionary.searchTerms(locale, query, facetValueIds, filters);
    },

    searchCreatorTerms(locale: Locale) {
      return repositories.dictionary.searchCreatorTerms(locale);
    },

    searchTermsPage(input: DictionaryPageInput) {
      return repositories.dictionary.searchTermsPage(input);
    },

    getTerm(termId: string, locale: Locale) {
      return repositories.dictionary.getTerm(termId, locale);
    },

    saveTermDraft(input: TermDraftInput, locale: Locale) {
      return repositories.dictionary.saveTermDraft(input, locale);
    },

    createTerm(input: NewTermInput) {
      return repositories.dictionary.createTerm(input);
    },

    approveTerm(termId: string, locale: Locale) {
      return repositories.dictionary.approveTerm(termId, locale);
    },

    withdrawTermApproval(termId: string, locale: Locale) {
      return repositories.dictionary.withdrawTermApproval(termId, locale);
    },

    setTermArchived(termId: string, archived: boolean, locale: Locale) {
      return repositories.dictionary.setTermArchived(termId, archived, locale);
    },

    addTermMedia(input: AddTermMediaInput) {
      return repositories.dictionary.addTermMedia(input);
    },

    setTermMediaCover(mediaId: string) {
      return repositories.dictionary.setTermMediaCover(mediaId);
    },

    removeTermMedia(mediaId: string) {
      return repositories.dictionary.removeTermMedia(mediaId);
    },

    reorderTermMedia(input: ReorderTermMediaInput) {
      return repositories.dictionary.reorderTermMedia(input);
    },

    createTermIllustrationBatch(input: Parameters<TermIllustrationRepository['createPreparing']>[0]) {
      return repositories.termIllustrations.createPreparing(input);
    },

    attachTermIllustrationGeneration(
      batchId: string,
      input: Parameters<TermIllustrationRepository['attachGeneration']>[1],
    ) {
      return repositories.termIllustrations.attachGeneration(batchId, input);
    },

    failTermIllustrationBatch(batchId: string, reason: unknown) {
      return repositories.termIllustrations.markFailed(batchId, reason);
    },

    listTermIllustrations(input: TermIllustrationListInput) {
      return repositories.termIllustrations.list(input.termId, input.limit);
    },

    adoptTermIllustration(input: TermIllustrationAdoptInput) {
      return repositories.termIllustrations.adopt(input.batchRunId, input.role);
    },

    dismissTermIllustration(batchRunId: string) {
      return repositories.termIllustrations.dismiss(batchRunId);
    },

    listDictionaryClassifications(locale: Locale) {
      return repositories.dictionaryClassifications.list(locale);
    },

    listDictionaryClassificationTerms(input: DictionaryClassificationTermsInput) {
      return repositories.dictionaryClassifications.listTerms(input);
    },

    createDictionaryClassification(input: DictionaryClassificationCreateInput) {
      return repositories.dictionaryClassifications.create(input);
    },

    updateDictionaryClassification(input: DictionaryClassificationUpdateInput) {
      return repositories.dictionaryClassifications.update(input);
    },

    restoreDictionaryClassificationSource(input: DictionaryClassificationRestoreSourceInput) {
      return repositories.dictionaryClassifications.restoreSource(input);
    },

    previewDictionaryClassificationMove(input: DictionaryClassificationMoveInput) {
      return repositories.dictionaryClassifications.previewMove(input);
    },

    moveDictionaryClassification(input: DictionaryClassificationMoveInput) {
      return repositories.dictionaryClassifications.move(input);
    },

    reorderDictionaryClassifications(input: DictionaryClassificationReorderInput) {
      return repositories.dictionaryClassifications.reorder(input);
    },

    setDictionaryClassificationState(input: DictionaryClassificationSetStateInput) {
      return repositories.dictionaryClassifications.setState(input);
    },

    previewDictionaryClassificationMerge(input: DictionaryClassificationMergeInput) {
      return repositories.dictionaryClassifications.previewMerge(input);
    },

    mergeDictionaryClassification(input: DictionaryClassificationMergeInput) {
      return repositories.dictionaryClassifications.merge(input);
    },

    stageImport(fileName: string, rows: JsonMap[]) {
      return repositories.imports.stageImport(fileName, rows);
    },

    commitImport(batchId: string) {
      return repositories.imports.commitImport(batchId);
    },
  };
}

export type DictionaryApi = ReturnType<typeof createDictionaryApi>;
