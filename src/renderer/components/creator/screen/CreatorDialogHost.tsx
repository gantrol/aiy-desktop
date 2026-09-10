import type { ComponentProps, ReactNode } from 'react';
import type {
  AlbumDto,
  ArticleDto,
  BootstrapDto,
  CreationInputSnapshotDto,
  CreationInputStashDto,
  Locale,
  PromptSeriesDto,
  VideoDocumentSummaryDto,
  WordPaletteDto,
} from '@/shared/contracts';
import { AlbumCreationDefaultsDialog } from '@/renderer/components/albums/AlbumCreationDefaultsDialog';
import { CreateAlbumDialog } from '@/renderer/components/albums/CreateAlbumDialog';
import { ApplyWordPaletteDialog } from '@/renderer/components/palette/ApplyWordPaletteDialog';
import { SaveWordPaletteDialog } from '@/renderer/components/palette/SaveWordPaletteDialog';
import { WordPaletteDetailsDialog } from '@/renderer/components/palette/WordPaletteDetailsDialog';
import { CreationInputStashDialog } from '@/renderer/components/creator/CreationInputStashDialog';
import { ImageImportPreviewDialog } from '@/renderer/components/creator/ImageImportPreviewDialog';
import { KnowledgeDistillationDialog } from '@/renderer/components/creator/KnowledgeDistillationDialog';
import { NewExternalCreationDialog } from '@/renderer/components/creator/NewExternalCreationDialog';
import { RenameAlbumDialog } from '@/renderer/components/creator/RenameAlbumDialog';
import { RenameArticleDialog } from '@/renderer/components/creator/RenameArticleDialog';
import { RenameSeriesDialog } from '@/renderer/components/creator/RenameSeriesDialog';
import { StyleExplorationDialog } from '@/renderer/components/creator/StyleExplorationDialog';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';
import type { CreatorPaletteInspector } from '@/renderer/components/creator/workflows/useCreatorDictionaryMaterials';
import type { useCreatorOutputImport } from '@/renderer/components/creator/useCreatorOutputImport';
import { VideoDocumentRenameDialog } from '@/renderer/features/video-documents/VideoDocumentRenameDialog';

interface Props {
  albumDefaults: AlbumDto | null;
  appliedPalettes: readonly AppliedWordPalette[];
  confirmationDialog: ReactNode;
  createAlbumBusy: boolean;
  createAlbumLabels: ComponentProps<typeof CreateAlbumDialog>['labels'];
  createAlbumRequest: { parent: AlbumDto | null; destination: 'LIBRARY' | 'NEW_CREATION' } | null;
  currentInput: CreationInputSnapshotDto;
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  direction: ComponentProps<typeof StyleExplorationDialog>;
  distilledPalette: WordPaletteDto | null;
  distillation: ComponentProps<typeof KnowledgeDistillationDialog>;
  externalAlbumId: string | null | undefined;
  externalOpen: boolean;
  inputStashBusy: boolean;
  inputStashes: readonly CreationInputStashDto[];
  inputStashOpen: boolean;
  locale: Locale;
  notify(message: string): void;
  outputImport: ReturnType<typeof useCreatorOutputImport>;
  paletteInspector: CreatorPaletteInspector;
  paletteToApply: WordPaletteDto | null;
  recipeSavedMessage: string;
  renameAlbum: AlbumDto | null;
  renameArticle: ArticleDto | null;
  renameDocument: VideoDocumentSummaryDto | null;
  renameSeriesOpen: boolean;
  series: PromptSeriesDto | undefined;
  seriesPrompt: string;
  onAlbumDefaultsChange(album: AlbumDto | null): void;
  onAlbumDefaultsSaved(): Promise<void>;
  onApplyPalette(palette: WordPaletteDto, values: Record<string, string>, locale: Locale): void;
  onCreateAlbum(parent: AlbumDto | null, title: string, destination: 'LIBRARY' | 'NEW_CREATION'): Promise<void>;
  onCreateAlbumRequestChange(value: Props['createAlbumRequest']): void;
  onCreateExternal: ComponentProps<typeof NewExternalCreationDialog>['onCreate'];
  onDistilledPaletteChange(palette: WordPaletteDto | null): void;
  onExternalOpenChange(open: boolean): void;
  onInputStashOpenChange(open: boolean): void;
  onPaletteApplicationDismiss(): void;
  onPaletteInspectorChange(value: CreatorPaletteInspector): void;
  onPaletteSaved(palette: WordPaletteDto): void;
  onRefresh(): Promise<void>;
  onRenameAlbum: ComponentProps<typeof RenameAlbumDialog>['onSave'];
  onRenameAlbumChange(album: AlbumDto | null): void;
  onRenameArticle: ComponentProps<typeof RenameArticleDialog>['onSave'];
  onRenameArticleChange(article: ArticleDto | null): void;
  onRenameDocument(id: string, title: string): Promise<void>;
  onRenameDocumentChange(document: VideoDocumentSummaryDto | null): void;
  onRenameSeriesOpenChange(open: boolean): void;
  onRestoreInputStash(stash: CreationInputStashDto): void;
  onStashCurrentInput(): Promise<void>;
}

export function CreatorDialogHost(props: Props) {
  return (
    <>
      {props.paletteToApply && (
        <ApplyWordPaletteDialog
          locale={props.locale}
          defaultPromptLocale={props.defaultPromptLocale ?? props.locale}
          palette={props.paletteToApply}
          initialValues={
            props.appliedPalettes.find((reference) => reference.palette.id === props.paletteToApply?.id)
              ?.parameterValues
          }
          initialPromptLocale={
            props.appliedPalettes.find((reference) => reference.palette.id === props.paletteToApply?.id)?.promptLocale
          }
          open
          onOpenChange={(open) => {
            if (!open) props.onPaletteApplicationDismiss();
          }}
          onApply={(values, promptLocale) => {
            if (props.paletteToApply) props.onApplyPalette(props.paletteToApply, values, promptLocale);
          }}
        />
      )}
      {props.paletteInspector?.mode === 'view' && (
        <WordPaletteDetailsDialog
          palette={props.paletteInspector.palette}
          open
          onOpenChange={(open) => {
            if (!open && props.paletteInspector?.mode === 'view') props.onPaletteInspectorChange(null);
          }}
          onEdit={(palette) => props.onPaletteInspectorChange({ mode: 'edit', palette })}
          notify={props.notify}
        />
      )}
      {props.paletteInspector?.mode === 'edit' && (
        <SaveWordPaletteDialog
          locale={props.locale}
          open
          palette={props.paletteInspector.palette}
          terms={props.data.terms}
          facets={props.data.facets}
          onOpenChange={(open) => {
            if (!open && props.paletteInspector?.mode === 'edit') props.onPaletteInspectorChange(null);
          }}
          onSaved={props.onPaletteSaved}
          onLifecycleChanged={() => void props.onRefresh()}
        />
      )}
      {props.direction.open && <StyleExplorationDialog {...props.direction} />}
      {props.distillation.open && <KnowledgeDistillationDialog {...props.distillation} />}
      {props.distilledPalette && (
        <SaveWordPaletteDialog
          locale={props.locale}
          open
          palette={props.distilledPalette}
          terms={props.data.terms}
          facets={props.data.facets}
          onOpenChange={(open) => {
            if (!open) props.onDistilledPaletteChange(null);
          }}
          onSaved={props.onPaletteSaved}
          onLifecycleChanged={() => void props.onRefresh()}
        />
      )}
      {props.outputImport.preview && (
        <ImageImportPreviewDialog
          open
          rows={props.outputImport.preview.rows}
          versions={props.series?.versions ?? []}
          busy={props.outputImport.busy}
          staging={props.outputImport.staging}
          onOpenChange={(open) => {
            if (!open) props.outputImport.dismiss();
          }}
          onAddFiles={() => void props.outputImport.chooseFiles()}
          onAddImages={(files, source, sourceUrl) => void props.outputImport.previewFiles(files, source, sourceUrl)}
          onRowChange={props.outputImport.updateRow}
          onAssignVersion={props.outputImport.assignVersion}
          onMoveRow={props.outputImport.moveRow}
          onRemoveRow={props.outputImport.removeRow}
          onConfirm={(rowIds) => void props.outputImport.commit(rowIds)}
        />
      )}
      {props.externalOpen && (
        <NewExternalCreationDialog
          open
          albums={props.data.albums}
          defaultAlbumId={props.externalAlbumId}
          onOpenChange={props.onExternalOpenChange}
          onCreate={props.onCreateExternal}
        />
      )}
      {props.inputStashOpen && (
        <CreationInputStashDialog
          open
          locale={props.locale}
          current={props.currentInput}
          stashes={[...props.inputStashes]}
          series={props.series}
          terms={props.data.terms}
          wordPalettes={props.data.wordPalettes}
          canvasPresets={props.data.canvasPresets}
          imageGenerationRoutes={props.data.imageGenerationRoutes}
          busy={props.inputStashBusy}
          onOpenChange={props.onInputStashOpenChange}
          onCreate={props.onStashCurrentInput}
          onRestore={props.onRestoreInputStash}
        />
      )}
      {props.albumDefaults && (
        <AlbumCreationDefaultsDialog
          album={props.albumDefaults}
          palettes={props.data.wordPalettes}
          locale={props.locale}
          onOpenChange={(open) => {
            if (!open) props.onAlbumDefaultsChange(null);
          }}
          onSaved={props.onAlbumDefaultsSaved}
          notify={props.notify}
        />
      )}
      {props.renameSeriesOpen && (
        <RenameSeriesDialog
          series={props.series}
          prompt={props.seriesPrompt}
          open
          onOpenChange={props.onRenameSeriesOpenChange}
          onSaved={props.onRefresh}
          notify={props.notify}
        />
      )}
      {props.createAlbumRequest && (
        <CreateAlbumDialog
          open
          parentTitle={props.createAlbumRequest.parent?.title}
          busy={props.createAlbumBusy}
          labels={props.createAlbumLabels}
          onOpenChange={(open) => {
            if (!open) props.onCreateAlbumRequestChange(null);
          }}
          onCreate={async (title) => {
            if (props.createAlbumRequest) {
              await props.onCreateAlbum(props.createAlbumRequest.parent, title, props.createAlbumRequest.destination);
            }
          }}
        />
      )}
      {props.renameAlbum && (
        <RenameAlbumDialog
          album={props.renameAlbum}
          open
          onOpenChange={(open) => {
            if (!open) props.onRenameAlbumChange(null);
          }}
          onSave={props.onRenameAlbum}
        />
      )}
      {props.renameArticle && (
        <RenameArticleDialog
          article={props.renameArticle}
          open
          onOpenChange={(open) => {
            if (!open) props.onRenameArticleChange(null);
          }}
          onSave={props.onRenameArticle}
        />
      )}
      {props.renameDocument && (
        <VideoDocumentRenameDialog
          open
          title={props.renameDocument.title}
          onOpenChange={(open) => {
            if (!open) props.onRenameDocumentChange(null);
          }}
          onSave={(title) => props.onRenameDocument(props.renameDocument!.id, title)}
        />
      )}
      {props.confirmationDialog}
    </>
  );
}
