import type { ComponentProps, ReactNode } from 'react';
import type { ArticleDto, BootstrapDto, EvaluationSuiteDto, Locale, SocialPostDto } from '@/shared/contracts';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import type { ContentLifecycleActionRequest } from '@/renderer/components/albums/useContentLifecycleActions';
import { AssetBreakdownSourceFormProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { ArticleEditor } from '@/renderer/components/creator/ArticleEditor';
import { CreatorAlbumDetail } from '@/renderer/components/creator/CreatorAlbumDetail';
import { ImageBreakdownWorkspace } from '@/renderer/components/creator/ImageBreakdownWorkspace';
import { SocialPostEditor } from '@/renderer/components/creator/SocialPostEditor';
import { EvaluationSuiteEditor } from '@/renderer/features/evaluations/EvaluationSuiteEditor';
import { creatorMaterialLifecycleTarget } from '@/renderer/components/creator/screen/creatorScreenProjection';
import { materialTitle } from '@/renderer/components/gallery/materialLibraryTypes';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import {
  naturalWatermarkBrowserCompanionAvailable,
  socialPostBrowserCompanionTargets,
} from '@/renderer/features/browser-companion/browserCompanionTargets';
import { CODEX_APP_SERVER_EXTENSION_ID } from '@/shared/extension-ids';

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
    createSocialPost(
      source: ArticleDto,
      ...args: Parameters<ArticleProps['onCreateSocialPost']>
    ): ReturnType<ArticleProps['onCreateSocialPost']>;
    export(articleId: string): ReturnType<NonNullable<ArticleProps['onExport']>>;
    generateHeader: ArticleProps['onGenerateHeader'];
    generateIllustration: ArticleProps['onGenerateIllustration'];
    onSaved: ArticleProps['onSaved'];
    save: ArticleProps['onSave'];
  };
  articleRelations: ArticleProps['relations'];
  album: AlbumProps['album'] | null;
  albumActions: {
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
    createSocialPost(
      source: SocialPostDto,
      ...args: Parameters<SocialProps['onCreateSocialPost']>
    ): ReturnType<SocialProps['onCreateSocialPost']>;
    generateCover: SocialProps['onGenerateCover'];
    save(source: SocialPostDto, ...args: Parameters<SocialProps['onSave']>): ReturnType<SocialProps['onSave']>;
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
          <SocialPostEditor
            key={props.socialPost.id}
            post={props.socialPost}
            locale={props.locale}
            canvasPresets={props.data.canvasPresets}
            handoffTargets={socialPostBrowserCompanionTargets(props.data.extensions ?? [])}
            watermarkAvailable={naturalWatermarkBrowserCompanionAvailable(props.data.extensions ?? [])}
            relations={props.socialPostRelations}
            onSave={(content) => props.socialPostActions.save(props.socialPost!, content)}
            onCreateSocialPost={(...args) => props.socialPostActions.createSocialPost(props.socialPost!, ...args)}
            onCreateArticle={(...args) => props.socialPostActions.createArticle(props.socialPost!, ...args)}
            onGenerateCover={props.socialPostActions.generateCover}
            onOpenRelation={props.onOpenRelation}
            notify={props.notify}
          />
        </div>
      )}
      {visible && props.article && (
        <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
          <ArticleEditor
            key={`${props.data.spaceId}:${props.article.id}`}
            article={props.article}
            spaceId={props.data.spaceId}
            locale={props.locale}
            canvasPresets={props.data.canvasPresets}
            relations={props.articleRelations}
            onSave={props.articleActions.save}
            onSaved={props.articleActions.onSaved}
            onCopyForWechat={(...args) => props.articleActions.copy(props.article!.id, ...args)}
            onExport={() => props.articleActions.export(props.article!.id)}
            onCreateArticle={(...args) => props.articleActions.createArticle(props.article!, ...args)}
            onCreateSocialPost={(...args) => props.articleActions.createSocialPost(props.article!, ...args)}
            onGenerateHeader={props.articleActions.generateHeader}
            onGenerateIllustration={props.articleActions.generateIllustration}
            onConfigureArticleCheck={() => props.onConfigureExtension(CODEX_APP_SERVER_EXTENSION_ID)}
            onOpenRelation={props.onOpenRelation}
            notify={props.notify}
          />
        </div>
      )}
      {visible && props.album && (
        <CreatorAlbumDetail
          key={props.album.id}
          album={props.album}
          albums={props.data.albums}
          creationSessions={props.creationSessions}
          creationItems={props.data.creationItems}
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
      )}
      {visible && props.evaluationSuite && (
        <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
          <EvaluationSuiteEditor
            key={props.evaluationSuite.id}
            suite={props.evaluationSuite}
            locale={props.locale}
            onSave={(content) => props.evaluationActions.save(props.evaluationSuite!, content)}
            notify={props.notify}
          />
        </div>
      )}
      {visible && props.imageBreakdown && (
        <AssetBreakdownSourceFormProvider sourceFormId={props.imageBreakdownSourceFormId}>
          <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
            <ImageBreakdownWorkspace
              key={props.imageBreakdown.id}
              breakdown={props.imageBreakdown}
              routes={props.data.imageBreakdownRoutes ?? []}
              locale={props.locale}
              refresh={props.refresh}
              onOpenSeries={(id) => props.onNavigateSeries(id, 'push')}
              notify={props.notify}
            />
          </div>
        </AssetBreakdownSourceFormProvider>
      )}
    </>
  );
}
