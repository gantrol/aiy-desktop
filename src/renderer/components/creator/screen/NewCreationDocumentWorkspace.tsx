import type { ReactNode } from 'react';
import { CreationDocumentStarter } from '@/renderer/components/creator/CreationDocumentStarter';
import { DocumentWritingPanel } from '@/renderer/components/creator/DocumentWritingPanel';
import { NewCreationDirections } from '@/renderer/components/creator/screen/NewCreationDirections';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import type { ImportedEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  model: CreatorScreenViewModel;
  autoFocus: boolean;
  materials: ReactNode;
  materialsImporting: boolean;
  references: ReactNode;
  onImageImported(image: ImportedEditorImage): void;
}

export function NewCreationDocumentWorkspace({
  model,
  autoFocus,
  materials,
  materialsImporting,
  references,
  onImageImported,
}: Props) {
  const { app, generation } = model;
  const { messages } = useI18n();
  const document = generation.promptDocument;
  return (
    <CreationDocumentStarter
      title={generation.title}
      onTitleChange={generation.setTitle}
      materials={materials}
      references={references}
      directions={<NewCreationDirections model={model} materialsImporting={materialsImporting} layout="grid" />}
      assistance={(editor) => (
        <DocumentWritingPanel
          key={generation.inputScopeKey}
          editor={editor}
          model={model}
          materialsImporting={materialsImporting}
        />
      )}
      composer={{
        ref: document.promptComposerRef,
        outlineMode: model.selection.creationStartMode === 'outline',
        autoFocus,
        locale: app.locale,
        termPromptLocale: app.defaultPromptLocale ?? document.termPromptLocale,
        promptProfileId: generation.configuration.promptProfileId,
        nodes: document.promptNodes,
        document: document.document,
        terms: app.data.terms,
        palettes: app.data.wordPalettes,
        appliedPalettes: document.appliedPalettes,
        onNodesChange: document.updatePromptDocument,
        onImageImported,
        onImageImportError: () => app.notify(messages.contentEditor.imageImportFailed),
        onOpenTerm: generation.dictionaryMaterials.openTerm,
        onOpenRecipe: generation.dictionaryMaterials.openPalette,
        onConfigureRecipe: generation.dictionaryMaterials.requestPalette,
        onRecipePromptLocaleChange: generation.dictionaryMaterials.changePaletteLocale,
        onRequestRecipeInsert: generation.dictionaryMaterials.requestPalette,
      }}
    />
  );
}
