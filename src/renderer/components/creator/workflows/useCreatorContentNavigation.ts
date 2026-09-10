import type {
  BootstrapDto,
  CreationFormDto,
  EvaluationSuiteContentInput,
  EvaluationSuiteDto,
  InspirationStashDto,
  Locale,
} from '@/shared/contracts';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import type { CreationRelationItem } from '@/renderer/components/creator/CreationRelationsSheet';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import { imageSeriesIdForCreationItem } from '@/renderer/components/creator/screen/creatorScreenProjection';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useGifMakerLauncher } from '@/renderer/features/gif-making/GifMakerProvider';
import type { DerivedVisualWorkspaceViewState } from '@/renderer/components/creator/derivedVisualWorkspace';

type ChooseSeries = (
  id: string,
  assetId?: string,
  navigationMode?: NavigationMode | null,
  versionId?: string,
) => Promise<boolean>;

interface Options {
  chooseSeries: ChooseSeries;
  clearSavedInspiration(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  data: BootstrapDto;
  locale: Locale;
  notify(message: string): void;
  onComparisonFullWindowChange(open: boolean): void;
  onPromptFullWindowChange(open: boolean): void;
  onSelectDocument(id: string, albumId: string | null): void;
  openParentEditor(): void;
  preserveBeforeNavigation(): Promise<boolean>;
  refresh(): Promise<void>;
  restoreInspiration(stash: InspirationStashDto): void;
  resumeDerivedVisual(visualId: string, view?: DerivedVisualWorkspaceViewState): Promise<unknown>;
  selectAlbum(id: string): void;
  selectArticle(id: string): void;
  selectEvaluationSuite(id: string): void;
  selectImageBreakdown(id: string): void;
  selectInspirationStash(id: string): void;
  selectSocialPost(id: string): void;
  setCompactPanel(panel: 'creator' | 'output'): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputMode(mode: CreationOutputMode): void;
  setRequestedAssetId(id: string | null): void;
  startNewCreation(albumId: string | null, mode: NavigationMode | null): Promise<boolean>;
}

// Keeps record/document navigation independent from draft persistence and generation ownership.
export function useCreatorContentNavigation(options: Options) {
  const animation = useGifMakerLauncher();
  const labels = useI18n().messages.creator.workNavigation;
  const resetOutput = useStableCallback(() => {
    options.setOutputMode('results');
    options.setRequestedAssetId(null);
    options.setOutputGalleryOpen(false);
    options.setCompactPanel('creator');
  });

  const chooseSocialPost = useStableCallback(async (id: string, mode: NavigationMode | null = 'push') => {
    const post = (options.data.socialPosts ?? []).find((item) => item.id === id);
    if (!post || !(await options.preserveBeforeNavigation())) return false;
    options.onComparisonFullWindowChange(false);
    options.openParentEditor();
    options.selectSocialPost(post.id);
    options.clearSavedInspiration();
    resetOutput();
    if (mode) options.commit({ surface: 'social-post', postId: post.id }, mode);
    return true;
  });

  const chooseArticle = useStableCallback(async (id: string, mode: NavigationMode | null = 'push') => {
    const article = (options.data.articles ?? []).find((item) => item.id === id);
    if (!article || !(await options.preserveBeforeNavigation())) return false;
    options.onComparisonFullWindowChange(false);
    options.openParentEditor();
    options.selectArticle(article.id);
    options.clearSavedInspiration();
    resetOutput();
    if (mode) options.commit({ surface: 'article', articleId: article.id }, mode);
    return true;
  });

  const chooseInspirationStash = useStableCallback(async (id: string, mode: NavigationMode | null = 'push') => {
    const stash = (options.data.inspirationStashes ?? []).find((item) => item.id === id);
    if (!stash) return false;
    const item = creationItemByFormEntity(options.data.creationItems, 'INSPIRATION_STASH', stash.id);
    if (!item) {
      options.notify(options.locale === 'zh' ? '灵感所属创作项不可用' : 'The inspiration creation item is unavailable');
      return false;
    }
    const hostSeriesId = imageSeriesIdForCreationItem(item);
    const opened = hostSeriesId
      ? await options.chooseSeries(hostSeriesId, undefined, null)
      : await options.startNewCreation(item.albumId, null);
    if (!opened) return false;
    options.onComparisonFullWindowChange(false);
    options.selectInspirationStash(stash.id);
    resetOutput();
    options.restoreInspiration(stash);
    if (mode) options.commit({ surface: 'inspiration-stash', stashId: stash.id }, mode);
    return true;
  });

  const openEvaluationSuite = useStableCallback((suite: EvaluationSuiteDto, mode: NavigationMode | null) => {
    options.onComparisonFullWindowChange(false);
    options.onPromptFullWindowChange(false);
    options.selectEvaluationSuite(suite.id);
    options.clearSavedInspiration();
    resetOutput();
    if (mode) options.commit({ surface: 'evaluation-suite', suiteId: suite.id }, mode);
  });

  const chooseEvaluationSuite = useStableCallback(async (id: string, mode: NavigationMode | null = 'push') => {
    const suite = (options.data.evaluationSuites ?? []).find((item) => item.id === id);
    if (!suite || !(await options.preserveBeforeNavigation())) return false;
    openEvaluationSuite(suite, mode);
    return true;
  });

  const saveEvaluationSuite = useStableCallback(
    async (suite: EvaluationSuiteDto, content: EvaluationSuiteContentInput) => {
      const saved = await window.desktopApi.evaluationSuiteSave({ id: suite.id, content });
      await options.refresh();
      return saved;
    },
  );

  const chooseImageBreakdown = useStableCallback(async (id: string, mode: NavigationMode | null = 'push') => {
    const breakdown = (options.data.imageBreakdowns ?? []).find((item) => item.id === id);
    if (!breakdown || !(await options.preserveBeforeNavigation())) return false;
    options.onComparisonFullWindowChange(false);
    options.onPromptFullWindowChange(false);
    options.selectImageBreakdown(id);
    options.clearSavedInspiration();
    resetOutput();
    if (mode) options.commit({ surface: 'image-breakdown', breakdownId: id }, mode);
    return true;
  });

  const chooseAlbum = useStableCallback(async (id: string, mode: NavigationMode | null = 'push') => {
    if (!(await options.preserveBeforeNavigation())) return false;
    options.onComparisonFullWindowChange(false);
    options.clearSavedInspiration();
    options.selectAlbum(id);
    resetOutput();
    if (mode) options.commit({ surface: 'album-detail', albumId: id }, mode);
    return true;
  });

  const chooseCreationForm = useStableCallback(async (form: CreationFormDto, assetId?: string) => {
    const id = form.entity.id;
    switch (form.entity.kind) {
      case 'ARTICLE':
        return chooseArticle(id);
      case 'SOCIAL_POST':
        return chooseSocialPost(id);
      case 'PROMPT_SERIES':
        return options.chooseSeries(id, assetId);
      case 'INSPIRATION_STASH':
        return chooseInspirationStash(id);
      case 'IMAGE_BREAKDOWN':
        return chooseImageBreakdown(id);
      case 'EVALUATION_SUITE':
        return chooseEvaluationSuite(id);
      case 'DERIVED_VISUAL':
        return options.resumeDerivedVisual(id, assetId ? { assetId } : undefined);
      case 'GIF_DOCUMENT':
        if (!animation) {
          options.notify(labels.openFailed);
          return;
        }
        if ((await options.preserveBeforeNavigation()) && animation.isCurrent())
          await animation.open({ documentId: id });
        return;
      case 'VIDEO_DOCUMENT':
        if (await options.preserveBeforeNavigation()) {
          const item = options.data.creationItems.find((item) => item.id === form.creationItemId);
          options.onSelectDocument(id, item?.albumId ?? null);
        }
        return;
    }
  });

  const openCreationRelation = useStableCallback(async (relation: CreationRelationItem) => {
    const form = options.data.creationItems
      .flatMap((item) => item.forms)
      .find((candidate) => candidate.id === relation.formId);
    if (!form) {
      options.notify(labels.openFailed);
      return;
    }
    try {
      await chooseCreationForm(form, relation.assetId);
    } catch {
      options.notify(labels.openFailed);
    }
  });

  return {
    chooseAlbum,
    chooseCreationForm,
    chooseArticle,
    chooseEvaluationSuite,
    chooseImageBreakdown,
    chooseInspirationStash,
    chooseSocialPost,
    openCreationRelation,
    saveEvaluationSuite,
  };
}
