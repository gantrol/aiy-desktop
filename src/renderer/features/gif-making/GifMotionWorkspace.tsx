import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { GifGenerationPanel } from '@/renderer/features/gif-making/GifGenerationPanel';
import { GifGenerationActions, GifGenerationStatus } from '@/renderer/features/gif-making/GifGenerationActions';
import { GifMotionRegionEditor } from '@/renderer/features/gif-making/GifMotionRegion';
import { GifChoice, GifNumber } from '@/renderer/features/gif-making/GifSettings';
import type { GifGenerationModel } from '@/renderer/features/gif-making/useGifGeneration';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';

export function GifMotionWorkspace({
  model,
  motion,
  onSkip,
  hasEditor,
}: {
  model: GifMakerModel;
  motion: GifGenerationModel;
  onSkip(): void;
  hasEditor: boolean;
}) {
  const { labels } = model;
  const disabled = model.busy || motion.running || motion.adopting;
  return (
    <>
      <PasteDropSurface
        className="min-h-0 flex-1 overflow-auto"
        disabled={disabled}
        respectEditableImagePaste
        onImages={(files) => void model.importFiles(files)}
      >
        <div className="grid items-start gap-6 p-4 @min-[720px]/gif-maker:grid-cols-2">
          <section
            className="min-w-0 space-y-3 @min-[720px]/gif-maker:sticky @min-[720px]/gif-maker:top-4"
            aria-label={labels.generation.source}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-medium">{labels.generation.source}</h3>
              <Input
                ref={model.fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                aria-label={labels.generation.source}
                disabled={disabled}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = '';
                  void model.importFiles(files);
                }}
              />
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => model.fileInput.current?.click()}>
                {labels.generation.changeSource}
              </Button>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => model.setPicker('frames')}>
                {labels.fromLibrary}
              </Button>
            </div>
            <div className="flex h-[clamp(240px,42vh,480px)] items-center justify-center overflow-hidden bg-muted/40 p-2">
              {motion.source ? (
                motion.mode === 'REGION' ? (
                  <GifMotionRegionEditor
                    source={motion.source}
                    region={motion.region}
                    onChange={motion.setRegion}
                    disabled={disabled}
                    label={labels.generation.regionLabel}
                  />
                ) : (
                  <img
                    src={motion.source.mediaUrl}
                    data-gif-source-id={motion.source.id}
                    alt={labels.generation.source}
                    className="max-h-full max-w-full object-contain"
                    onError={motion.failedPreview}
                  />
                )
              ) : (
                <Button variant="outline" disabled={disabled} onClick={() => model.fileInput.current?.click()}>
                  {labels.generation.changeSource}
                </Button>
              )}
            </div>
            <fieldset disabled={disabled} className="space-y-3">
              <GifChoice
                label={labels.generation.mode}
                value={motion.mode}
                options={[
                  { value: 'WHOLE', label: labels.generation.whole },
                  { value: 'REGION', label: labels.generation.region },
                ]}
                onChange={motion.setMode}
              />
              {motion.mode === 'REGION' && (
                <div className="grid grid-cols-2 items-end gap-2">
                  <GifNumber
                    label={labels.generation.feather}
                    value={motion.feather}
                    min={0}
                    max={0.4}
                    step={0.05}
                    onChange={motion.setFeather}
                  />
                  <Button variant="ghost" size="sm" disabled={!motion.region} onClick={() => motion.setRegion(null)}>
                    {labels.generation.clearRegion}
                  </Button>
                </div>
              )}
            </fieldset>
          </section>
          <GifGenerationPanel motion={motion} disabled={model.busy} />
        </div>
      </PasteDropSurface>
      <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t px-4 py-3">
        <div role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">
          {model.project.error ? labels.errors[model.project.error] : <GifGenerationStatus motion={motion} />}
          {motion.providerMessage && <div className="max-h-24 overflow-auto break-words">{motion.providerMessage}</div>}
        </div>
        {!hasEditor && !motion.plan && !motion.running && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onSkip}>
            {labels.generation.skip}
          </Button>
        )}
        <GifGenerationActions motion={motion} disabled={model.busy} />
      </footer>
    </>
  );
}
