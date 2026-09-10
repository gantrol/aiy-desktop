import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import { AnnotationRefinementInput } from '@/renderer/components/creator/AnnotationRefinementInput';
import { AssistantWritingAction } from '@/renderer/components/creator/AssistantWritingAction';
import type { CreationAssistantMode } from '@/renderer/components/creator/CreationCollaborationPanel';
import { CreationStartActions, type CreationStartPlan } from '@/renderer/components/creator/CreationStartActions';
import {
  CreatorPromptComposer,
  type CreatorPromptComposerHandle,
} from '@/renderer/components/creator/CreatorPromptComposer';
import { GenerationLauncher } from '@/renderer/components/creator/GenerationLauncher';
import type { GenerationReadiness } from '@/renderer/components/creator/generationReadiness';
import { InspirationStashAction } from '@/renderer/components/creator/InspirationStashAction';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { CompanionHandoffButton } from '@/renderer/features/browser-companion/CompanionHandoffButton';
import type { ImportedEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type {
  AssistantWebSearchMode,
  CreatorPromptNodeInput,
  GenerationTargetInput,
  ImageGenerationRouteDto,
  Locale,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { LightbulbIcon, LoaderCircleIcon, Maximize2Icon, Minimize2Icon } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type Ref } from 'react';

interface Props {
  locale: Locale;
  termPromptLocale: Locale;
  promptProfileId: string;
  prompt: string;
  promptNodes: CreatorPromptNodeInput[];
  document?: BlockDocument;
  onImageImported?(image: ImportedEditorImage): void;
  onImageImportError?(): void;
  terms: TermListItem[];
  palettes: WordPaletteDto[];
  appliedPalettes: AppliedWordPalette[];
  composerRef: Ref<CreatorPromptComposerHandle>;
  assistantBusy: boolean;
  assistantMode: CreationAssistantMode | null;
  companionHandoffBusy: boolean;
  canRequestIdeas: boolean;
  canBuildPrompt: boolean;
  routes: ImageGenerationRouteDto[];
  generationTargets: GenerationTargetInput[];
  generationCount: number;
  readiness: GenerationReadiness;
  stashReady: boolean;
  stashing: boolean;
  stashed: boolean;
  starting: boolean;
  planning: boolean;
  imageToolsOpen?: boolean;
  startReady: boolean;
  fullWindow: boolean;
  annotationRefinement: AnnotationRefinementState | null;
  materialPicker: ReactNode;
  dictionaryPicker: ReactNode;
  dictionarySidebar: ReactNode;
  canvasPicker: ReactNode;
  videoPicker?: ReactNode;
  references: ReactNode;
  sourceContext?: ReactNode;
  titleInput?: ReactNode;
  experiments?: ReactNode;
  showStashAction?: boolean;
  onPromptNodesChange(nodes: CreatorPromptNodeInput[], document?: BlockDocument): void;
  onOpenTerm(term: TermListItem): void;
  onOpenRecipe(paletteId: string): void;
  onConfigureRecipe(palette: WordPaletteDto): void;
  onRecipePromptLocaleChange(paletteId: string, promptLocale: Locale): void;
  onRequestRecipeInsert(palette: WordPaletteDto, position: number): void;
  onRequestIdeas(): void | Promise<void>;
  onBuildPrompt(webSearchMode: AssistantWebSearchMode): void | Promise<void>;
  onHandoffPrompt(): void;
  onGenerationTargetsChange(targets: GenerationTargetInput[]): void;
  onConfigureExtension(extensionId: string): void;
  onGenerate(): void;
  onStashInspiration(): void;
  onStartCreation(plan: CreationStartPlan): void;
  onOpenExternalImport(): void;
  onChooseVideoDocument(): void;
  onFullWindowChange(open: boolean): void;
}

export function MinimalCreationStarter({
  locale,
  termPromptLocale,
  promptProfileId,
  prompt,
  promptNodes,
  document,
  onImageImported,
  onImageImportError,
  terms,
  palettes,
  appliedPalettes,
  composerRef,
  assistantBusy,
  assistantMode,
  companionHandoffBusy,
  canRequestIdeas,
  canBuildPrompt,
  routes,
  generationTargets,
  generationCount,
  readiness,
  stashReady,
  stashing,
  stashed,
  starting,
  planning,
  imageToolsOpen,
  startReady,
  fullWindow,
  annotationRefinement,
  materialPicker,
  dictionaryPicker,
  dictionarySidebar,
  canvasPicker,
  videoPicker,
  references,
  sourceContext,
  titleInput,
  experiments,
  showStashAction = true,
  onPromptNodesChange,
  onOpenTerm,
  onOpenRecipe,
  onConfigureRecipe,
  onRecipePromptLocaleChange,
  onRequestRecipeInsert,
  onRequestIdeas,
  onBuildPrompt,
  onHandoffPrompt,
  onGenerationTargetsChange,
  onConfigureExtension,
  onGenerate,
  onStashInspiration,
  onStartCreation,
  onOpenExternalImport,
  onChooseVideoDocument,
  onFullWindowChange,
}: Props) {
  const labels = useI18n().messages.creator.starter;
  const inputLabel = useI18n().messages.contentEditor.input;
  const characterCount = Array.from(prompt).length;
  const fullWindowButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!fullWindow) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onFullWindowChange(false);
      requestAnimationFrame(() => fullWindowButtonRef.current?.focus());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullWindow, onFullWindowChange]);

  return (
    <ScrollArea
      type="always"
      data-creation-prompt-full-window={fullWindow ? 'true' : 'false'}
      className={cn('min-h-0 flex-1 bg-background', fullWindow && 'size-full')}
    >
      <div
        className={cn(
          'mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-6 lg:px-8',
          fullWindow &&
            'grid size-full max-w-none grid-cols-[minmax(500px,44vw)_minmax(0,1fr)] overflow-hidden p-0 lg:p-0',
        )}
      >
        {fullWindow && (
          <aside className="min-h-0 min-w-0 overflow-hidden border-r bg-background">{dictionarySidebar}</aside>
        )}
        <div
          className={cn('my-auto flex w-full flex-col', fullWindow && 'my-0 min-h-0 min-w-0 overflow-hidden p-5 pt-14')}
        >
          <section
            data-prompt-composer
            className={cn(
              'corner-continuous overflow-hidden rounded-xl border bg-surface transition-colors duration-fast focus-within:border-ring',
              fullWindow && 'flex min-h-0 flex-1 flex-col',
            )}
          >
            {sourceContext}
            <div className="flex h-10 shrink-0 items-center justify-between gap-3 px-5 pt-1">
              <span className="text-xs font-semibold text-foreground-secondary">{inputLabel}</span>
              <div className="flex items-center gap-2">
                {characterCount > 0 && (
                  <span className="text-2xs tabular-nums text-muted-foreground">
                    {labels.characters(characterCount)}
                  </span>
                )}
                <Button
                  ref={fullWindowButtonRef}
                  type="button"
                  variant={fullWindow ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => onFullWindowChange(!fullWindow)}
                >
                  {fullWindow ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
                  {fullWindow ? labels.exitFullWindow : labels.fullWindow}
                </Button>
              </div>
            </div>
            {titleInput}
            <CreatorPromptComposer
              ref={composerRef}
              locale={locale}
              termPromptLocale={termPromptLocale}
              promptProfileId={promptProfileId}
              nodes={promptNodes}
              document={document}
              onImageImported={onImageImported}
              onImageImportError={onImageImportError}
              terms={terms}
              palettes={palettes}
              appliedPalettes={appliedPalettes}
              placeholder={labels.placeholder}
              ariaLabel={labels.promptLabel}
              fullWindow={fullWindow}
              onNodesChange={onPromptNodesChange}
              onOpenTerm={onOpenTerm}
              onOpenRecipe={onOpenRecipe}
              onConfigureRecipe={onConfigureRecipe}
              onRecipePromptLocaleChange={onRecipePromptLocaleChange}
              onRequestRecipeInsert={onRequestRecipeInsert}
            />
            <div
              className={cn(
                'max-h-[min(12rem,30vh)] overflow-y-auto px-4 pb-3 [scrollbar-gutter:stable]',
                fullWindow && 'max-h-[min(10rem,22vh)] shrink-0',
              )}
            >
              {references}
            </div>
            {annotationRefinement && <AnnotationRefinementInput refinement={annotationRefinement} />}
            <div className="flex flex-wrap items-center gap-2 border-t bg-surface-sunken/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                {materialPicker}
                {planning && videoPicker}
                {!fullWindow && dictionaryPicker}
                {canvasPicker}
              </div>
              <div data-prompt-assistant-actions className="ml-auto flex items-center gap-1">
                <CompanionHandoffButton
                  variant="ghost"
                  disabled={!canBuildPrompt || assistantBusy || companionHandoffBusy}
                  busy={companionHandoffBusy}
                  onHandoff={() => onHandoffPrompt()}
                  targets={['chatgpt']}
                  zh={locale === 'zh'}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canRequestIdeas || assistantBusy}
                  onClick={() => void onRequestIdeas()}
                >
                  {assistantBusy && assistantMode === 'directions' ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : (
                    <LightbulbIcon className="size-4" />
                  )}
                  {labels.ideas}
                </Button>
                <AssistantWritingAction
                  variant="ghost"
                  disabled={!canBuildPrompt || assistantBusy}
                  busy={assistantBusy && assistantMode === 'optimize'}
                  label={labels.buildPrompt}
                  searchLabel={labels.searchAndOptimize}
                  optionsLabel={labels.writingOptions}
                  onRun={onBuildPrompt}
                />
              </div>
            </div>
            {!planning && (
              <GenerationLauncher
                embedded
                locale={locale}
                routes={routes}
                generationTargets={generationTargets}
                generationCount={generationCount}
                readiness={readiness}
                starting={starting}
                interactionBlocked={showStashAction && stashing}
                secondaryAction={
                  showStashAction ? (
                    <InspirationStashAction
                      locale={locale}
                      ready={stashReady}
                      busy={stashing}
                      saved={stashed}
                      blocked={starting}
                      onClick={onStashInspiration}
                    />
                  ) : undefined
                }
                onGenerationTargetsChange={onGenerationTargetsChange}
                onConfigureExtension={onConfigureExtension}
                onGenerate={onGenerate}
              />
            )}
          </section>
          {planning && (
            <CreationStartActions
              imageToolsOpen={imageToolsOpen}
              locale={locale}
              routes={routes}
              generationTargets={generationTargets}
              generationCount={generationCount}
              readiness={readiness}
              stashReady={stashReady}
              stashing={stashing}
              stashed={stashed}
              startReady={startReady}
              starting={starting}
              onStashInspiration={onStashInspiration}
              onStartCreation={onStartCreation}
              onOpenExternalImport={onOpenExternalImport}
              onChooseVideoDocument={onChooseVideoDocument}
              onGenerationTargetsChange={onGenerationTargetsChange}
              onConfigureExtension={onConfigureExtension}
              onGenerate={onGenerate}
            />
          )}
          {!fullWindow && experiments}
        </div>
      </div>
    </ScrollArea>
  );
}
