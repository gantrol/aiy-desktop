import { useMemo } from 'react';
import { VideoIcon } from 'lucide-react';
import type { BootstrapDto, CreatorPromptNodeInput, GenerationTargetInput } from '@/shared/contracts';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';
import { CanvasPresetPicker } from '@/renderer/components/creator/CanvasPresetPicker';
import { CreationMaterialPicker } from '@/renderer/components/creator/CreationMaterialPicker';
import { CreationReferenceStrip } from '@/renderer/components/creator/CreationReferenceStrip';
import { MinimalCreationStarter } from '@/renderer/components/creator/MinimalCreationStarter';
import { generationReadiness } from '@/renderer/components/creator/generationReadiness';
import { resolveCreatorPrompt } from '@/renderer/components/creator/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { DictionaryIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { FeatureDemoRunPlan } from '@/renderer/features/extensions/feature-demo/featureDemoRunPlan';
import { imageCreationDemoStateAt } from '@/renderer/features/extensions/feature-demo/featureDemoSceneState';

const ignore = () => undefined;

// Replays a saved input through the same starter used by the creation workspace.
// The stage is inert; no draft, assistant request or generation task is created.
export function FeatureDemoImageCreation({
  data,
  plan,
  progress,
}: {
  data: BootstrapDto;
  plan: FeatureDemoRunPlan;
  progress: number;
}) {
  const { locale, messages } = useI18n();
  const state = imageCreationDemoStateAt(progress);
  const series = data.series.find((candidate) => candidate.id === plan.creationSeriesId);
  const version = series?.versions.find((candidate) => candidate.id === plan.creationVersionId);
  const run =
    version?.runs.find((candidate) => candidate.asset?.id === plan.comparisonAssetId) ??
    version?.runs.find((candidate) => candidate.outputDisposition !== 'FAILED' && candidate.asset);
  const route =
    data.imageGenerationRoutes.find((candidate) => candidate.key === run?.modelKey) ??
    data.imageGenerationRoutes.find(
      (candidate) => candidate.state === 'READY' && candidate.capabilities.includes('GENERATE'),
    );
  const prompt = state.hasInput ? version?.finalPrompt || version?.manualPrompt || '' : '';
  const references = useMemo(() => (state.hasInput ? (version?.referenceAssets ?? []) : []), [state.hasInput, version]);
  const nodes = useMemo<CreatorPromptNodeInput[]>(() => (prompt ? [{ kind: 'TEXT', text: prompt }] : []), [prompt]);
  const targets = useMemo<GenerationTargetInput[]>(
    () =>
      route ? [{ modelKey: route.key, quality: run?.quality ?? route.supportedQualities[0] ?? 'low', count: 1 }] : [],
    [route, run],
  );
  const promptProfileId = imageGenerationPromptProfileId(route);
  const resolution = useMemo(
    () =>
      resolveCreatorPrompt({
        manualPrompt: prompt,
        promptNodes: nodes,
        selectedTerms: [],
        appliedPalettes: [],
        termPromptLocale: version?.termPromptLocale ?? locale,
        promptProfileId,
      }),
    [locale, nodes, prompt, promptProfileId, version?.termPromptLocale],
  );
  const readiness = generationReadiness({
    prompt,
    selectedModelKeys: targets.map((target) => target.modelKey),
    referenceCount: references.length,
    routes: data.imageGenerationRoutes,
  });

  return (
    <div className="flex size-full min-h-0">
      <MinimalCreationStarter
        locale={locale}
        termPromptLocale={version?.termPromptLocale ?? locale}
        promptProfileId={promptProfileId}
        prompt={prompt}
        promptNodes={nodes}
        terms={data.terms}
        palettes={data.wordPalettes}
        appliedPalettes={[]}
        composerRef={null}
        assistantBusy={false}
        assistantMode={null}
        companionHandoffBusy={false}
        canRequestIdeas
        canBuildPrompt={Boolean(prompt)}
        routes={data.imageGenerationRoutes}
        generationTargets={targets}
        generationCount={1}
        readiness={readiness}
        stashReady={Boolean(prompt)}
        stashing={false}
        stashed={false}
        starting={false}
        planning
        imageToolsOpen={state.imageToolsOpen}
        startReady={Boolean(prompt)}
        fullWindow={false}
        annotationRefinement={null}
        materialPicker={
          <CreationMaterialPicker
            libraryKey={data.spaceName}
            dataRevision={0}
            terms={data.terms}
            facets={data.facets}
            selectedAssets={references}
            onApply={ignore}
            onImport={ignore}
          />
        }
        videoPicker={
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label={messages.contentEditor.addVideos}
            title={messages.contentEditor.addVideos}
          >
            <VideoIcon className="size-4" />
          </Button>
        }
        dictionaryPicker={
          <Button
            variant="outline"
            size="icon"
            className="rounded-full shadow-none"
            aria-label={messages.creator.workbench.dictionary}
            title={messages.creator.workbench.dictionary}
          >
            <DictionaryIcon className="size-4" />
          </Button>
        }
        dictionarySidebar={null}
        canvasPicker={
          <CanvasPresetPicker
            locale={locale}
            presets={data.canvasPresets}
            value={
              state.hasInput
                ? data.canvasPresets.find((preset) => preset.stableKey === run?.canvasPresetKey)
                : undefined
            }
            compact
            toolbar
            onChange={ignore}
          />
        }
        references={
          <CreationReferenceStrip
            assets={references}
            promptResolution={resolution}
            hidePromptMaterials
            removeLabel={messages.creator.workbench.delete}
            onAssetsChange={ignore}
            onOpenPalette={ignore}
            onOpenTerm={ignore}
            onRemoveAsset={ignore}
            onRemovePalette={ignore}
            onRemoveTerm={ignore}
            notify={ignore}
          />
        }
        titleInput={
          <Input
            readOnly
            value={state.hasInput ? (series?.title ?? '') : ''}
            aria-label={messages.creator.starter.title}
            placeholder={messages.creator.starter.title}
            className="h-11 shrink-0 rounded-none border-0 bg-transparent px-12 text-lg font-medium focus-visible:ring-inset focus-visible:ring-offset-0"
          />
        }
        onPromptNodesChange={ignore}
        onOpenTerm={ignore}
        onOpenRecipe={ignore}
        onConfigureRecipe={ignore}
        onRecipePromptLocaleChange={ignore}
        onRequestRecipeInsert={ignore}
        onRequestIdeas={ignore}
        onBuildPrompt={ignore}
        onHandoffPrompt={ignore}
        onGenerationTargetsChange={ignore}
        onConfigureExtension={ignore}
        onGenerate={ignore}
        onStashInspiration={ignore}
        onStartCreation={ignore}
        onOpenExternalImport={ignore}
        onChooseVideoDocument={ignore}
        onFullWindowChange={ignore}
      />
    </div>
  );
}
