import { useMemo } from 'react';
import { ImageIcon, DictionaryIcon, CloseIcon } from '@/renderer/icons';
import { Button } from '@/renderer/components/ui/button';
import { MinimalCreationStarter } from '@/renderer/components/creator/MinimalCreationStarter';
import { CreatorInputHeader } from '@/renderer/components/creator/screen/CreatorInputHeader';
import { CanvasPresetPicker } from '@/renderer/components/creator/CanvasPresetPicker';
import { generationReadiness } from '@/renderer/components/creator/generationReadiness';
import { useI18n } from '@/renderer/i18n/useI18n';
import { demoMedia } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';
import {
  demoGenerationTargets,
  demoNoop,
  demoPreparedRoute,
} from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
import { demoPromptText } from '@/renderer/features/extensions/feature-demo/v050/demoWorkspaceScene';
import { demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import type { CreatorPromptNodeInput } from '@/shared/contracts';
import './DemoCreationInput.css';

export function DemoCreationInput({ time, onError }: { time: number; onError(): void }) {
  const { locale, messages } = useI18n();
  const copy = messages.extensions.featureDemo.v050;
  const c = messages.creator.workbench;
  const prompt = demoPromptText(time, copy.noteText);
  const nodes = useMemo<CreatorPromptNodeInput[]>(() => (prompt ? [{ kind: 'TEXT', text: prompt }] : []), [prompt]);
  const routes = useMemo(() => [demoPreparedRoute(copy.prepared)], [copy.prepared]);
  return (
    <section
      className="demo-v050-input flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
      data-typing={time >= demoCues.promptFocus && time < demoCues.generateApproach}
      data-caret-visible={Math.floor(time * 2) % 2 === 0}
    >
      <CreatorInputHeader
        albums={[]}
        allSeries={[]}
        busy={false}
        creationMode="new"
        creationStartMode="image"
        derived={null}
        experiment={null}
        inspirationSelected={false}
        inputStashBusy={false}
        labels={{
          importedPrompt: messages.creator.comparison.importedPrompt,
          newPrompt: c.newPrompt,
          noMatchingVersions: c.noMatchingVersions,
          rename: c.rename,
          searchVersions: c.searchVersions,
          version: c.version,
          videoStartTitle: messages.videoDocuments.start.title,
        }}
        locale={locale}
        newCreationSurface={false}
        promptFullWindow={false}
        series={undefined}
        sessionHostSeries={undefined}
        targetAlbumId={null}
        version={undefined}
        viewingExperimentBranch={false}
        onBackToSource={demoNoop}
        onChangeAlbum={demoNoop}
        onChooseVersion={demoNoop}
        onCreateAlbum={demoNoop}
        onCreateDerivedScheme={demoNoop}
        onOpenInputStashes={demoNoop}
        onRenameSeries={demoNoop}
        onResumeDerivedVisual={demoNoop}
        onSelectImageMode={demoNoop}
      />
      <MinimalCreationStarter
        locale={locale}
        termPromptLocale={locale}
        promptProfileId="demo"
        prompt={prompt}
        promptNodes={nodes}
        terms={[]}
        palettes={[]}
        appliedPalettes={[]}
        composerRef={null}
        assistantBusy={false}
        assistantMode={null}
        companionHandoffBusy={false}
        canRequestIdeas={Boolean(prompt)}
        canBuildPrompt={Boolean(prompt)}
        routes={routes}
        generationTargets={demoGenerationTargets}
        generationCount={1}
        readiness={generationReadiness({ prompt, selectedModelKeys: ['demo-prepared'], referenceCount: 1, routes })}
        stashReady={Boolean(prompt)}
        stashing={false}
        stashed={false}
        starting={false}
        planning={false}
        startReady={Boolean(prompt)}
        fullWindow={false}
        annotationRefinement={null}
        materialPicker={
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label={copy.sourceImage}
            onClick={demoNoop}
          >
            <ImageIcon />
          </Button>
        }
        dictionaryPicker={
          <Button variant="outline" size="icon" className="rounded-full" aria-label={c.dictionary} onClick={demoNoop}>
            <DictionaryIcon />
          </Button>
        }
        dictionarySidebar={null}
        canvasPicker={
          <CanvasPresetPicker locale={locale} presets={[]} value={undefined} compact toolbar onChange={demoNoop} />
        }
        references={
          <div className="relative mt-1 h-16 w-24 overflow-hidden rounded-sm bg-muted" aria-label={copy.sourceImage}>
            <img
              data-demo-media="source"
              src={demoMedia.character}
              alt={copy.sourceImage}
              className="size-full object-contain"
              onError={onError}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-0 top-0 size-5 bg-background/90"
              aria-label={messages.creator.derivedVisual.removeReference(1)}
              onClick={demoNoop}
            >
              <CloseIcon className="size-3" />
            </Button>
          </div>
        }
        onPromptNodesChange={demoNoop}
        onOpenTerm={demoNoop}
        onOpenRecipe={demoNoop}
        onConfigureRecipe={demoNoop}
        onRecipePromptLocaleChange={demoNoop}
        onRequestRecipeInsert={demoNoop}
        onRequestIdeas={demoNoop}
        onBuildPrompt={demoNoop}
        onHandoffPrompt={demoNoop}
        onGenerationTargetsChange={demoNoop}
        onConfigureExtension={demoNoop}
        onGenerate={demoNoop}
        onStashInspiration={demoNoop}
        onStartCreation={demoNoop}
        onOpenExternalImport={demoNoop}
        onChooseVideoDocument={demoNoop}
        onFullWindowChange={demoNoop}
      />
    </section>
  );
}
