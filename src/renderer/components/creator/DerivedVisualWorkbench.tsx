import { CheckIcon, ImageIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  AssetDto,
  CanvasPresetDto,
  DerivedVisualDto,
  GenerationTargetInput,
  GenerationTaskDto,
  ImageGenerationRouteDto,
  Locale,
  PromptSeriesDto,
} from '@/shared/contracts';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { derivedVisualCanvasPresetKeys } from '@/renderer/components/creator/derivedVisualWorkspace';
import { GenerationLauncher } from '@/renderer/components/creator/GenerationLauncher';
import type { GenerationReadiness } from '@/renderer/components/creator/generationReadiness';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Textarea } from '@/renderer/components/ui/textarea';
import { cn } from '@/renderer/lib/utils';

interface Props {
  visual: DerivedVisualDto;
  locale: Locale;
  prompt: string;
  canvasPreset: CanvasPresetDto | undefined;
  canvasPresets: readonly CanvasPresetDto[];
  series: PromptSeriesDto | undefined;
  routes: ImageGenerationRouteDto[];
  generationTargets: GenerationTargetInput[];
  generationCount: number;
  generationTasks: GenerationTaskDto[];
  readiness: GenerationReadiness;
  starting: boolean;
  resizeValue: number;
  resizeMin: number;
  resizeMax: number;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeValueChange(value: number): void;
  onPromptChange(prompt: string): void;
  onCanvasPresetChange(preset: CanvasPresetDto): void;
  onGenerationTargetsChange(targets: GenerationTargetInput[]): void;
  onConfigureExtension(extensionId: string): void;
  onGenerate(): void;
  onAdopt(visualId: string, imageAssetId: string): Promise<void>;
  onClose(): void;
  notify(message: string): void;
}

function availableAssets(series: PromptSeriesDto | undefined) {
  if (!series) return [];
  const byId = new Map<string, AssetDto>();
  for (const version of series.versions) {
    for (const run of version.runs) {
      if (run.asset && run.outputDisposition !== 'FAILED') byId.set(run.asset.id, run.asset);
    }
  }
  for (const output of series.importedOutputs ?? []) byId.set(output.asset.id, output.asset);
  for (const output of series.transformedOutputs ?? []) byId.set(output.asset.id, output.asset);
  return [...byId.values()].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

function roleTitle(role: DerivedVisualDto['role'], zh: boolean) {
  if (role === 'ARTICLE_HEADER') return zh ? '题图' : 'Hero image';
  if (role === 'ARTICLE_INLINE') return zh ? '配图' : 'Illustration';
  return zh ? '封面' : 'Cover';
}

function adoptLabel(role: DerivedVisualDto['role'], zh: boolean) {
  if (role === 'ARTICLE_HEADER') return zh ? '设为题图' : 'Set as hero';
  if (role === 'ARTICLE_INLINE') return zh ? '插入此处' : 'Insert here';
  return zh ? '设为首图' : 'Set as cover';
}

function DerivedVisualPreview({
  visual,
  asset,
  canvasPreset,
  previewMode,
  running,
  zh,
  notify,
  onPreviewModeChange,
}: {
  visual: DerivedVisualDto;
  asset: AssetDto | null;
  canvasPreset: CanvasPresetDto | undefined;
  previewMode: 'full' | 'square';
  running: boolean;
  zh: boolean;
  notify(message: string): void;
  onPreviewModeChange(mode: 'full' | 'square'): void;
}) {
  const squarePreview = previewMode === 'square' && visual.role === 'ARTICLE_HEADER';
  const emptyLabel = running ? (zh ? '正在生成' : 'Generating') : zh ? '尚未生成' : 'Not generated';
  return (
    <div className="relative flex min-h-44 flex-1 items-center justify-center overflow-hidden bg-muted/35 p-4">
      {visual.role === 'ARTICLE_HEADER' && asset && (
        <Segmented
          type="single"
          value={previewMode}
          className="absolute top-3 right-3 z-10 h-7 bg-background/95"
          onValueChange={(value) => value && onPreviewModeChange(value as 'full' | 'square')}
        >
          <SegmentedItem value="full" className="h-6 px-2.5">
            {zh ? '横图' : 'Banner'}
          </SegmentedItem>
          <SegmentedItem value="square" className="h-6 px-2.5">
            {zh ? '方形预览' : 'Square crop'}
          </SegmentedItem>
        </Segmented>
      )}
      {asset ? (
        <AssetFileContextMenu assetId={asset.id} notify={notify}>
          {squarePreview ? (
            <div className="aspect-square w-full max-w-[min(100%,28rem)] overflow-hidden bg-media-surround-light ring-1 ring-foreground/10">
              <img src={asset.mediaUrl} alt="" className="size-full object-contain" draggable={false} />
            </div>
          ) : (
            <img
              src={asset.mediaUrl}
              alt=""
              className="max-h-[min(46vh,38rem)] max-w-full bg-media-surround-light object-contain ring-1 ring-foreground/10"
            />
          )}
        </AssetFileContextMenu>
      ) : (
        <div
          className="grid w-full max-w-md place-items-center border bg-background text-muted-foreground"
          style={{ aspectRatio: canvasPreset ? `${canvasPreset.width} / ${canvasPreset.height}` : '4 / 3' }}
        >
          {running ? <LoaderCircleIcon className="size-6 animate-spin" /> : <ImageIcon className="size-7" />}
          <span className="sr-only">{emptyLabel}</span>
        </div>
      )}
      {running && asset && (
        <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-overlay/95 px-2 py-1 text-xs shadow-overlay">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {zh ? '生成中' : 'Generating'}
        </span>
      )}
    </div>
  );
}

function DerivedVisualCandidates({
  assets,
  selectedAsset,
  zh,
  notify,
  onSelect,
}: {
  assets: readonly AssetDto[];
  selectedAsset: AssetDto | null;
  zh: boolean;
  notify(message: string): void;
  onSelect(assetId: string): void;
}) {
  if (!assets.length) return null;
  return (
    <div className="shrink-0 border-t bg-surface-sunken/35 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>{zh ? '候选' : 'Candidates'}</span>
        <span className="tabular-nums">
          {Math.max(1, assets.findIndex((asset) => asset.id === selectedAsset?.id) + 1)} / {assets.length}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {assets.map((asset) => (
          <AssetFileContextMenu key={asset.id} assetId={asset.id} notify={notify}>
            <button
              type="button"
              className={cn(
                'h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-inset ring-foreground/10 outline-none hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-ring',
                asset.id === selectedAsset?.id && 'ring-2 ring-ring',
              )}
              aria-pressed={asset.id === selectedAsset?.id}
              onClick={() => onSelect(asset.id)}
            >
              <img
                src={mediaThumbnailUrl(asset, 160)}
                alt=""
                width={asset.width}
                height={asset.height}
                className="size-full bg-media-surround-light object-contain"
                draggable={false}
              />
            </button>
          </AssetFileContextMenu>
        ))}
      </div>
    </div>
  );
}

export function DerivedVisualWorkbench({
  visual,
  locale,
  prompt,
  canvasPreset,
  canvasPresets,
  series,
  routes,
  generationTargets,
  generationCount,
  generationTasks,
  readiness,
  starting,
  resizeValue,
  resizeMin,
  resizeMax,
  onResizeStart,
  onResizeValueChange,
  onPromptChange,
  onCanvasPresetChange,
  onGenerationTargetsChange,
  onConfigureExtension,
  onGenerate,
  onAdopt,
  onClose,
  notify,
}: Props) {
  const zh = locale === 'zh';
  const assets = useMemo(() => availableAssets(series), [series]);
  const presets = useMemo(() => {
    const allowed = new Set(derivedVisualCanvasPresetKeys[visual.role]);
    return canvasPresets.filter((preset) => allowed.has(preset.stableKey));
  }, [canvasPresets, visual.role]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(visual.selectedImageAssetId);
  const [previewMode, setPreviewMode] = useState<'full' | 'square'>('full');
  const [adopting, setAdopting] = useState(false);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0] ?? null;
  const selectedAlreadyAdopted = Boolean(selectedAsset && visual.selectedImageAssetId === selectedAsset.id);
  const running = starting || Boolean(series && generationTasks.some((task) => task.seriesId === series.id));
  const lastFailure = series?.versions
    .flatMap((version) => version.runs)
    .filter((run) => run.status === 'FAILED')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  useEffect(() => {
    setSelectedAssetId((current) => {
      if (current && assets.some((asset) => asset.id === current)) return current;
      if (visual.selectedImageAssetId && assets.some((asset) => asset.id === visual.selectedImageAssetId)) {
        return visual.selectedImageAssetId;
      }
      return assets[0]?.id ?? null;
    });
  }, [assets, visual.selectedImageAssetId]);

  useEffect(() => setPreviewMode('full'), [visual.id]);

  async function adopt() {
    if (!selectedAsset || adopting) return;
    setAdopting(true);
    try {
      await onAdopt(visual.id, selectedAsset.id);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAdopting(false);
    }
  }

  return (
    <section
      data-derived-visual-workbench
      data-derived-visual-id={visual.id}
      className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
    >
      <CreatorPaneResizeHandle
        edge="left"
        label={zh ? '调整生成面板宽度' : 'Resize generation panel'}
        value={resizeValue}
        min={resizeMin}
        max={resizeMax}
        onValueChange={onResizeValueChange}
        onPointerDown={onResizeStart}
      />
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <strong className="shrink-0 text-sm">{roleTitle(visual.role, zh)}</strong>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {presets.map((preset) => (
            <Button
              key={preset.stableKey}
              type="button"
              variant={canvasPreset?.stableKey === preset.stableKey ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 shrink-0 px-2 tabular-nums"
              aria-pressed={canvasPreset?.stableKey === preset.stableKey}
              onClick={() => onCanvasPresetChange(preset)}
            >
              {preset.ratio}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={zh ? '返回编辑' : 'Back to editor'}
          aria-label={zh ? '返回编辑' : 'Back to editor'}
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      </header>

      <DerivedVisualPreview
        visual={visual}
        asset={selectedAsset}
        canvasPreset={canvasPreset}
        previewMode={previewMode}
        running={running}
        zh={zh}
        notify={notify}
        onPreviewModeChange={setPreviewMode}
      />

      <DerivedVisualCandidates
        assets={assets}
        selectedAsset={selectedAsset}
        zh={zh}
        notify={notify}
        onSelect={setSelectedAssetId}
      />

      <div className="max-h-[46%] shrink-0 overflow-y-auto border-t bg-background">
        <div className="px-3 pt-3 pb-2">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
            <label htmlFor={`derived-visual-prompt-${visual.id}`}>{zh ? '提示词' : 'Prompt'}</label>
            <span className="font-normal tabular-nums text-muted-foreground">{Array.from(prompt).length}</span>
          </div>
          <Textarea
            id={`derived-visual-prompt-${visual.id}`}
            value={prompt}
            maxLength={30_000}
            className="min-h-28 max-h-40 resize-y leading-6"
            onChange={(event) => onPromptChange(event.target.value)}
          />
          {lastFailure?.errorMessage && !running && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {lastFailure.errorMessage}
            </p>
          )}
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
        <div className="border-t p-3">
          <Button
            type="button"
            className="w-full"
            disabled={!selectedAsset || adopting || selectedAlreadyAdopted}
            onClick={() => void adopt()}
          >
            {adopting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
            {selectedAlreadyAdopted ? (zh ? '已采用' : 'Applied') : adoptLabel(visual.role, zh)}
          </Button>
        </div>
      </div>
    </section>
  );
}
