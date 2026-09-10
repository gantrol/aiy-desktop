import type { ArticleDto, AssetDto, BootstrapDto } from '@/shared/contracts';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import { buildCreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { articleMediaBindings } from '@/renderer/components/creator/article-editor/articleContentTransforms';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { captureBlockDocument } from '@/shared/contracts/block-document';

export type ImageContentVariantKind = 'manuscript';

function imageSourceForm(data: BootstrapDto, seriesId: string) {
  const find = (id: string) => {
    const visual = data.derivedVisuals?.find((item) => item.promptSeriesId === id);
    return visual
      ? creationFormByEntity(data.creationItems, 'DERIVED_VISUAL', visual.id)
      : creationFormByEntity(data.creationItems, 'PROMPT_SERIES', id);
  };
  const direct = find(seriesId);
  if (direct) return direct;
  const session = buildCreationSessionProjection(data.series, data.styleExplorationBatches).find((item) =>
    item.memberSeries.some((member) => member.id === seriesId),
  );
  return session ? find(session.primarySeries.id) : null;
}

export function useCreatorImageVariantWorkflow(options: {
  data: BootstrapDto;
  captureSelectionIdentity(): string;
  refresh(): Promise<void>;
  onOpenArticle(article: ArticleDto): void;
  notify(message: string): void;
}) {
  const { messages } = useI18n();
  const captureSelectionIdentity = useStableCallback(options.captureSelectionIdentity);
  return useStableCallback(async (kind: ImageContentVariantKind, asset: AssetDto, seriesId: string) => {
    const source = imageSourceForm(options.data, seriesId);
    if (!source) throw new Error(messages.creator.socialPostEditor.itemUnavailable);
    const title = options.data.series.find((series) => series.id === seriesId)?.title ?? '';
    const identity = captureSelectionIdentity();
    const sourceInput = { sourceFormId: source.form.id, sourceInspirationStashId: null };
    const mediaBindings = articleMediaBindings([asset], 'reference');
    const document = captureBlockDocument({
      type: 'doc',
      content: [{ type: 'image', attrs: { assetId: asset.id, alt: '' } }],
    });
    const article = await window.desktopApi.articleFormCreate({
      ...sourceInput,
      content: {
        schemaVersion: 2,
        document,
        title,
        markdown: blockDocumentMarkdown(document, mediaBindings),
        mediaBindings,
        coverAssetId: asset.id,
      },
    });
    try {
      await options.refresh();
    } catch {
      options.notify(messages.creator.workNavigation.savedRefreshFailed);
      return;
    }
    if (captureSelectionIdentity() === identity) {
      options.onOpenArticle(article);
    }
    options.notify(messages.creator.socialPostEditor.articleCreated);
  });
}
