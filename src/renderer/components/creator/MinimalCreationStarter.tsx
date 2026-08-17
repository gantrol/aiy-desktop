import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { LightbulbIcon, LoaderCircleIcon, Maximize2Icon, Minimize2Icon } from 'lucide-react';
import type {
  AssistantWebSearchMode,
  CreatorPromptNodeInput,
  ImageGenerationRouteDto,
  GenerationTargetInput,
  Locale,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { AssistantWritingAction } from '@/renderer/components/creator/AssistantWritingAction';
import { AnnotationRefinementInput } from '@/renderer/components/creator/AnnotationRefinementInput';
import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import type { CreationAssistantMode } from '@/renderer/components/creator/CreationCollaborationPanel';
import {
  CreatorPromptComposer,
  type CreatorPromptComposerHandle,
} from '@/renderer/components/creator/CreatorPromptComposer';
import { GenerationLauncher } from '@/renderer/components/creator/GenerationLauncher';
import type { GenerationReadiness } from '@/renderer/components/creator/generationReadiness';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  locale: Locale;
  termPromptLocale: Locale;
  promptProfileId: string;
  prompt: string;
  promptNodes: CreatorPromptNodeInput[];
  terms: TermListItem[];
  palettes: WordPaletteDto[];
  appliedPalettes: AppliedWordPalette[];
  composerRef: Ref<CreatorPromptComposerHandle>;
  assistantBusy: boolean;
  assistantMode: CreationAssistantMode | null;
  canRequestIdeas: boolean;
  canBuildPrompt: boolean;
  routes: ImageGenerationRouteDto[];
  generationTargets: GenerationTargetInput[];
  generationCount: number;
  readiness: GenerationReadiness;
  starting: boolean;
  fullWindow: boolean;
  annotationRefinement: AnnotationRefinementState | null;
  materialPicker: ReactNode;
  dictionaryPicker: ReactNode;
  dictionarySidebar: ReactNode;
  canvasPicker: ReactNode;
  references: ReactNode;
  experiments?: ReactNode;
  onPromptNodesChange(nodes: CreatorPromptNodeInput[]): void;
  onOpenTerm(term: TermListItem): void;
  onOpenRecipe(paletteId: string): void;
  onConfigureRecipe(palette: WordPaletteDto): void;
  onRecipePromptLocaleChange(paletteId: string, promptLocale: Locale): void;
  onRequestRecipeInsert(palette: WordPaletteDto, position: number): void;
  onRequestIdeas(): void | Promise<void>;
  onBuildPrompt(webSearchMode: AssistantWebSearchMode): void | Promise<void>;
  onGenerationTargetsChange(targets: GenerationTargetInput[]): void;
  onConfigureExtension(extensionId: string): void;
  onGenerate(): void;
  onFullWindowChange(open: boolean): void;
}

export function MinimalCreationStarter({
  locale,
  termPromptLocale,
  promptProfileId,
  prompt,
  promptNodes,
  terms,
  palettes,
  appliedPalettes,
  composerRef,
  assistantBusy,
  assistantMode,
  canRequestIdeas,
  canBuildPrompt,
  routes,
  generationTargets,
  generationCount,
  readiness,
  starting,
  fullWindow,
  annotationRefinement,
  materialPicker,
  dictionaryPicker,
  dictionarySidebar,
  canvasPicker,
  references,
  experiments,
  onPromptNodesChange,
  onOpenTerm,
  onOpenRecipe,
  onConfigureRecipe,
  onRecipePromptLocaleChange,
  onRequestRecipeInsert,
  onRequestIdeas,
  onBuildPrompt,
  onGenerationTargetsChange,
  onConfigureExtension,
  onGenerate,
  onFullWindowChange,
}: Props) {
  const labels = useI18n().messages.creator.starter;
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
            <div className="flex h-10 shrink-0 items-center justify-between gap-3 px-5 pt-1">
              <span className="text-xs font-semibold text-foreground-secondary">{labels.promptLabel}</span>
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
            <CreatorPromptComposer
              ref={composerRef}
              locale={locale}
              termPromptLocale={termPromptLocale}
              promptProfileId={promptProfileId}
              nodes={promptNodes}
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
                {!fullWindow && dictionaryPicker}
                {canvasPicker}
              </div>
              <div data-prompt-assistant-actions className="ml-auto flex items-center gap-1">
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
            <GenerationLauncher
              embedded
              locale={locale}
              routes={routes}
              generationTargets={generationTargets}
              generationCount={generationCount}
              readiness={readiness}
              starting={starting}
              onGenerationTargetsChange={onGenerationTargetsChange}
              onConfigureExtension={onConfigureExtension}
              onGenerate={onGenerate}
            />
          </section>
          {!fullWindow && experiments}
        </div>
      </div>
    </ScrollArea>
  );
}
