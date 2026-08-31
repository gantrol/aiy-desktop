import type {
  BootstrapDto,
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
  openParentEditor(): void;
  preserveBeforeNavigation(): Promise<boolean>;
  refresh(): Promise<void>;
  restoreInspiration(stash: InspirationStashDto): void;
  resumeDerivedVisual(visualId: string): Promise<unknown>;
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

  const openCreationRelation = useStableCallback(async (relation: CreationRelationItem) => {
    const form = options.data.creationItems
      .flatMap((item) => item.forms)
      .find((candidate) => candidate.id === relation.formId);
    if (!form) {
      options.notify(options.locale === 'zh' ? '关联内容不可用' : 'Related content is unavailable');
      return;
    }
    if (form.entity.kind === 'ARTICLE') await chooseArticle(form.entity.id);
    else if (form.entity.kind === 'SOCIAL_POST') await chooseSocialPost(form.entity.id);
    else if (form.entity.kind === 'DERIVED_VISUAL') await options.resumeDerivedVisual(form.entity.id);
  });

  return {
    chooseAlbum,
    chooseArticle,
    chooseEvaluationSuite,
    chooseImageBreakdown,
    chooseInspirationStash,
    chooseSocialPost,
    openCreationRelation,
    saveEvaluationSuite,
  };
}
