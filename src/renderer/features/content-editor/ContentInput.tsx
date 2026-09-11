import { ContentBlockEditor } from '@/renderer/features/content-editor/ContentBlockEditor';
import {
  importVideoDocumentEditorImage,
  type ImportedEditorImage,
  type VideoDocumentArticleElementControls,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import type { VideoDocumentArticleElementsChangeReason } from '@/renderer/features/video-documents/videoDocumentEditorPublication';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentAssetPath } from '@/shared/content-document';
import type { ArticleElementPlacementInput, AssetDto, CreatorImageImportSource } from '@/shared/contracts';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { useMemo } from 'react';

interface Props {
  markdown: string;
  document?: BlockDocument;
  onDocumentChange?(document: BlockDocument): void;
  sessionIdentity: string;
  assets: readonly (Pick<AssetDto, 'id' | 'mediaUrl'> &
    Partial<Pick<AssetDto, 'mimeType' | 'width' | 'height' | 'byteSize'>>)[];
  compact?: boolean;
  embedded?: boolean;
  toolbarVisible?: boolean;
  toolbarRoot?: HTMLDivElement | null;
  contentSource?: import('@/shared/contracts/content-library').ContentSource;
  readOnly?: boolean;
  mediaIntake?: 'INLINE' | 'EXTERNAL';
  onChange(markdown: string): void;
  onSave(): void;
  onError(): void;
  onImageImported?(image: ImportedEditorImage): void;
  importImage?(file: File, source: CreatorImageImportSource, importId?: string): Promise<ImportedEditorImage>;
  onInputPendingChange?(pending: boolean): void;
  onHandleChange?(handle: VideoDocumentWysiwygEditorHandle | null): void;
  articleElements?: readonly ArticleElementPlacementInput[];
  articleElementControls?: VideoDocumentArticleElementControls;
  onArticleElementsChange?(
    elements: readonly ArticleElementPlacementInput[],
    reason: VideoDocumentArticleElementsChangeReason,
  ): void;
}

/** All authoring surfaces use the same editor. The host owns saving, media and navigation. */
export function ContentInput(props: Props) {
  const { editor: copy, document: labels } = useI18n().messages.desktopPetals;
  const bindings = useMemo(
    () =>
      props.assets.map((asset) => ({
        path: contentAssetPath(asset.id),
        assetId: asset.id,
        kind: 'IMAGE' as const,
        timestampMs: null,
        endTimestampMs: null,
        posterAssetId: null,
      })),
    [props.assets],
  );
  const importImage = async (file: File, source: CreatorImageImportSource, importId?: string) => {
    const result = await (props.importImage ?? importVideoDocumentEditorImage)(file, source, importId);
    const path = contentAssetPath(result.binding.assetId);
    return { ...result, binding: { ...result.binding, path }, attributes: { ...result.attributes, sourcePath: path } };
  };
  return (
    <ContentBlockEditor
      {...props}
      ariaLabel={labels.body}
      mediaBindings={bindings}
      media={props.assets.map((asset) => ({
        assetId: asset.id,
        mediaUrl: asset.mediaUrl,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        byteSize: asset.byteSize ?? 0,
        durationMs: null,
      }))}
      labels={{
        ...copy,
        searchResultCount: (current, total) =>
          copy.searchResultCount.replace('{current}', String(current)).replace('{total}', String(total)),
      }}
      importImage={importImage}
      onImageImported={(result) =>
        props.onImageImported?.({
          ...result,
          attributes: { src: result.media.mediaUrl, sourcePath: result.binding.path, alt: null, title: null },
        })
      }
      onImageImportError={props.onError}
      onEditorHandleChange={(handle) => props.onHandleChange?.(handle)}
    />
  );
}
