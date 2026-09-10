import { lazy, type ComponentProps, type ReactNode } from 'react';
import type { ArticleDto, BootstrapDto, EvaluationSuiteDto, Locale, SocialPostDto } from '@/shared/contracts';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import type { ContentLifecycleActionRequest } from '@/renderer/components/albums/useContentLifecycleActions';
import { AssetBreakdownSourceFormProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { WorkspaceDetailLoadingBoundary } from '@/renderer/components/app/WorkspaceDetailLoadingBoundary';
import { creatorMaterialLifecycleTarget } from '@/renderer/components/creator/screen/creatorScreenProjection';
import { materialTitle } from '@/renderer/components/gallery/materialLibraryTypes';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import {
  naturalWatermarkBrowserCompanionAvailable,
  socialPostBrowserCompanionTargets,
} from '@/renderer/features/browser-companion/browserCompanionTargets';
import { CODEX_APP_SERVER_EXTENSION_ID } from '@/shared/extension-ids';

const ArticleEditor = lazy(() =>
  import('@/renderer/components/creator/ArticleEditor').then((module) => ({ default: module.ArticleEditor })),
);
const CreatorAlbumDetail = lazy(() =>
  import('@/renderer/components/creator/CreatorAlbumDetail').then((module) => ({ default: module.CreatorAlbumDetail })),
);
const ImageBreakdownWorkspace = lazy(() =>
  import('@/renderer/components/creator/ImageBreakdownWorkspace').then((module) => ({
    default: module.ImageBreakdownWorkspace,
  })),
);
const SocialPostEditor = lazy(() =>
  import('@/renderer/components/creator/SocialPostEditor').then((module) => ({ default: module.SocialPostEditor })),
);
const EvaluationSuiteEditor = lazy(() =>
  import('@/renderer/features/evaluations/EvaluationSuiteEditor').then((module) => ({
    default: module.EvaluationSuiteEditor,
  })),
);

type SocialProps = ComponentProps<typeof SocialPostEditor>;
type ArticleProps = ComponentProps<typeof ArticleEditor>;
type AlbumProps = ComponentProps<typeof CreatorAlbumDetail>;
type EvaluationProps = ComponentProps<typeof EvaluationSuiteEditor>;

interface Props {
  article: ArticleDto | null;
  articleActions: {
    copy(
      articleId: string,
      ...args: Parameters<ArticleProps['onCopyForWechat']>
    ): ReturnType<ArticleProps['onCopyForWechat']>;
    createArticle(
      source: ArticleDto,
      ...args: Parameters<ArticleProps['onCreateArticle']>
    ): ReturnType<ArticleProps['onCreateArticle']>;
    export(articleId: string): ReturnType<NonNullable<ArticleProps['onExport']>>;
    generateHeader: ArticleProps['onGenerateHeader'];
    generateIllustration: ArticleProps['onGenerateIllustration'];
    onSaved: ArticleProps['onSaved'];
    save: ArticleProps['onSave'];
  };
  articleRelations: ArticleProps['relations'];
  album: AlbumProps['album'] | null;
  albumActions: {
    openCreationForm: AlbumProps['onOpenCreationForm'];
    moveAlbum: AlbumProps['onMoveAlbum'];
    moveCreationItem: AlbumProps['onMoveCreationItem'];
    openOutline: AlbumProps['onOpenOutline'];
    archive: AlbumProps['onArchive'];
    createCreation(albumId: string): void;
    delete: AlbumProps['onDelete'];
    openMaterial: AlbumProps['onOpenMaterial'];
    rename: AlbumProps['onRename'];
    selectAlbum: AlbumProps['onSelectAlbum'];
    selectDocument: AlbumProps['onSelectDocument'];
    selectSeries: AlbumProps['onSelectSeries'];
    settings: AlbumProps['onSettings'];
    togglePin: AlbumProps['onTogglePin'];
  };
  comparisonFullWindow: boolean;
  compactPanel: 'library' | 'creator' | 'output';
  creationSessions: readonly CreationSessionProjection[];
  creationLibraryFilter: AlbumProps['filter'];
  data: BootstrapDto;
  documentNavigationRevision: number;
  documentWorkspace: ReactNode | null;
  documentWorkspaceActive: boolean;
  evaluationActions: {
    save(
      suite: EvaluationSuiteDto,
      ...args: Parameters<EvaluationProps['onSave']>
    ): ReturnType<EvaluationProps['onSave']>;
  };
  evaluationSuite: EvaluationSuiteDto | null;
  imageBreakdown: ComponentProps<typeof ImageBreakdownWorkspace>['breakdown'] | null;
  imageBreakdownSourceFormId: string | null;
  lifecycleBusy: boolean;
  locale: Locale;
  messages: {
    generated: string;
    reference: string;
    textMaterial: string;
  };
  multiPane: boolean;
  notify(message: string): void;
  onContentLifecycleAction(request: ContentLifecycleActionRequest): void;
  onConfigureExtension(extensionId: string): void;
  onNavigateSeries(seriesId: string, mode?: NavigationMode): void;
  promptFullWindow: boolean;
  refresh(): Promise<void>;
  socialPost: SocialPostDto | null;
  socialPostActions: {
    createArticle(
      source: SocialPostDto,
      ...args: Parameters<SocialProps['onCreateArticle']>
    ): ReturnType<SocialProps['onCreateArticle']>;
    generateCover: SocialProps['onGenerateCover'];
    save: SocialProps['onSave'];
  };
  socialPostRelations: SocialProps['relations'];
  onOpenRelation: SocialProps['onOpenRelation'];
}

export function CreatorWorkspaceRouter(props: Props) {
  const visible =
    !props.documentWorkspaceActive &&
    !props.comparisonFullWindow &&
    !props.promptFullWindow &&
    (props.multiPane || props.compactPanel === 'creator');
  const materialFallback = (kind: 'TEXT' | 'GENERATED' | 'REFERENCE') =>
    kind === 'TEXT'
      ? props.messages.textMaterial
      : kind === 'GENERATED'
        ? props.messages.generated
        : props.messages.reference;

  return (
    <>
      {props.documentWorkspace && (
        <div
          className={`${props.documentWorkspaceActive && (props.multiPane || props.compactPanel === 'creator') ? 'flex' : 'hidden'} min-h-0 min-w-0 overflow-hidden bg-background ${props.documentWorkspaceActive ? '[&>*]:size-full' : ''}`}
        >
          {props.documentWorkspace}
        </div>
      )}
      {visible && props.socialPost && (
        <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
          <WorkspaceDetailLoadingBoundary>
            <SocialPostEditor
              key={`${props.data.spaceId}:${props.socialPost.id}`}
              post={props.socialPost}
              locale={props.locale}
              canvasPresets={props.data.canvasPresets}
              handoffTargets={socialPostBrowserCompanionTargets(props.data.extensions ?? [])}
              watermarkAvailable={naturalWatermarkBrowserCompanionAvailable(props.data.extensions ?? [])}
              relations={props.socialPostRelations}
              spaceId={props.data.spaceId}
              onSave={props.socialPostActions.save}
              onCreateArticle={(...args) => props.socialPostActions.createArticle(props.socialPost!, ...args)}
              onGenerateCover={props.socialPostActions.generateCover}
              onOpenRelation={props.onOpenRelation}
              notify={props.notify}
            />
          </WorkspaceDetailLoadingBoundary>
        </div>
      )}
      {visible && props.article && (
        <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
          <WorkspaceDetailLoadingBoundary>
            <ArticleEditor
              key={`${props.data.spaceId}:${props.article.id}`}
              article={props.article}
              spaceId={props.data.spaceId}
              locale={props.locale}
              canvasPresets={props.data.canvasPresets}
              extensions={props.data.extensions ?? []}
              relations={props.articleRelations}
              onSave={props.articleActions.save}
              onSaved={props.articleActions.onSaved}
              onCopyForWechat={(...args) => props.articleActions.copy(props.article!.id, ...args)}
              onExport={() => props.articleActions.export(props.article!.id)}
              onCreateArticle={(...args) => props.articleActions.createArticle(props.article!, ...args)}
              onGenerateHeader={props.articleActions.generateHeader}
              onGenerateIllustration={props.articleActions.generateIllustration}
              onConfigureArticleCheck={() => props.onConfigureExtension(CODEX_APP_SERVER_EXTENSION_ID)}
              onOpenRelation={props.onOpenRelation}
              notify={props.notify}
            />
          </WorkspaceDetailLoadingBoundary>
        </div>
      )}
      {visible && props.album && (
        <WorkspaceDetailLoadingBoundary className="min-h-0 min-w-0 overflow-hidden">
          <CreatorAlbumDetail
            key={props.album.id}
            album={props.album}
            data={props.data}
            creationSessions={props.creationSessions}
            onOpenCreationForm={props.albumActions.openCreationForm}
            onMoveAlbum={props.albumActions.moveAlbum}
            onMoveCreationItem={props.albumActions.moveCreationItem}
            onOpenOutline={props.albumActions.openOutline}
            filter={props.creationLibraryFilter}
            documentNavigationRevision={props.documentNavigationRevision}
            busy={props.lifecycleBusy}
            onSelectAlbum={props.albumActions.selectAlbum}
            onSelectSeries={props.albumActions.selectSeries}
            onSelectDocument={props.albumActions.selectDocument}
            onOpenMaterial={props.albumActions.openMaterial}
            onArchiveMaterial={(item) =>
              props.onContentLifecycleAction({
                action: 'ARCHIVE',
                target: creatorMaterialLifecycleTarget(item),
                title: materialTitle(
                  item,
                  materialFallback(
                    item.kind === 'TEXT' ? 'TEXT' : item.image.asset.kind === 'GENERATED' ? 'GENERATED' : 'REFERENCE',
                  ),
                ),
              })
            }
            onDeleteMaterial={(item) =>
              props.onContentLifecycleAction({
                action: 'DELETE',
                target: creatorMaterialLifecycleTarget(item),
                title: materialTitle(
                  item,
                  materialFallback(
                    item.kind === 'TEXT' ? 'TEXT' : item.image.asset.kind === 'GENERATED' ? 'GENERATED' : 'REFERENCE',
                  ),
                ),
              })
            }
            onRename={props.albumActions.rename}
            onDelete={props.albumActions.delete}
            onTogglePin={props.albumActions.togglePin}
            onArchive={props.albumActions.archive}
            onCreateCreation={() => props.albumActions.createCreation(props.album!.id)}
            onSettings={props.albumActions.settings}
            notify={props.notify}
          />
        </WorkspaceDetailLoadingBoundary>
      )}
      {visible && props.evaluationSuite && (
        <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
          <WorkspaceDetailLoadingBoundary>
            <EvaluationSuiteEditor
              key={props.evaluationSuite.id}
              suite={props.evaluationSuite}
              locale={props.locale}
              onSave={(content) => props.evaluationActions.save(props.evaluationSuite!, content)}
              notify={props.notify}
            />
          </WorkspaceDetailLoadingBoundary>
        </div>
      )}
      {visible && props.imageBreakdown && (
        <AssetBreakdownSourceFormProvider sourceFormId={props.imageBreakdownSourceFormId}>
          <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
            <WorkspaceDetailLoadingBoundary>
              <ImageBreakdownWorkspace
                key={props.imageBreakdown.id}
                breakdown={props.imageBreakdown}
                routes={props.data.imageBreakdownRoutes ?? []}
                locale={props.locale}
                refresh={props.refresh}
                onOpenSeries={(id) => props.onNavigateSeries(id, 'push')}
                notify={props.notify}
              />
            </WorkspaceDetailLoadingBoundary>
          </div>
        </AssetBreakdownSourceFormProvider>
      )}
    </>
  );
}
