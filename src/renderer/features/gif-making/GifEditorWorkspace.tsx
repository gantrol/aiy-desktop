import { useState, type ReactNode } from 'react';
import { LoaderCircleIcon, Maximize2Icon, Minimize2Icon, PlusIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { GifCanvas } from '@/renderer/features/gif-making/GifCanvas';
import { GifFrameStrip } from '@/renderer/features/gif-making/GifFrameStrip';
import { GifSettings } from '@/renderer/features/gif-making/GifSettings';
import { GifSourceToolbar } from '@/renderer/features/gif-making/GifSourceToolbar';
import { GifFrameControls } from '@/renderer/features/gif-making/GifFrameControls';
import { GifMakerFooter } from '@/renderer/features/gif-making/GifMakerFooter';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';

export function GifEditorWorkspace({
  model,
  adoption,
  expanded: controlledExpanded,
  onExpandedChange,
  preview,
  frameImageUrl,
  exportStatus,
}: {
  model: GifMakerModel;
  adoption?: ReactNode;
  expanded?: boolean;
  onExpandedChange?(expanded: boolean): void;
  preview?: ReactNode;
  frameImageUrl?: Parameters<typeof GifFrameStrip>[0]['imageUrl'];
  exportStatus?: ReactNode;
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;
  const { labels, project, busy, manifest, selected, playing, sequence, playIndex, assets, result, showEncoded } =
    model;
  return (
    <>
      <PasteDropSurface
        className="min-h-0 flex-1 overflow-auto"
        disabled={busy || model.exporting}
        onImages={(files) => void model.importFiles(files)}
        respectEditableImagePaste
        overlay={<PlusIcon className="size-8" />}
      >
        <GifSourceToolbar model={model} />
        <div className="flex flex-col gap-4 px-3 @min-[720px]/gif-maker:flex-row">
          <div className="min-w-0 flex-1">
            <div className="flex justify-end pb-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={expanded ? labels.collapsePreview : labels.expandPreview}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
              </Button>
            </div>
            <div
              className={
                expanded
                  ? 'flex h-[min(60vh,520px)] items-center justify-center overflow-hidden bg-muted/40 p-2'
                  : 'flex h-64 items-center justify-center overflow-hidden bg-muted/40 p-2'
              }
            >
              {preview !== undefined ? (
                preview
              ) : project.loading ? (
                <LoaderCircleIcon className="size-5 animate-spin" />
              ) : showEncoded && result ? (
                <img
                  src={result.asset.mediaUrl}
                  data-gif-output-id={result.asset.id}
                  alt={labels.encoded}
                  className="max-h-full max-w-full object-contain"
                />
              ) : selected ? (
                <GifCanvas
                  manifest={manifest}
                  frame={playing ? sequence[playIndex % sequence.length] : selected}
                  assets={assets}
                  label={labels.preview}
                  onError={model.fail}
                />
              ) : (
                <Button variant="ghost" onClick={() => model.fileInput.current?.click()}>
                  {labels.empty}
                </Button>
              )}
            </div>
          </div>
          {model.settings && (
            <fieldset disabled={busy || model.exporting} className="w-full shrink-0 py-2 @min-[720px]/gif-maker:w-64">
              <GifSettings
                manifest={manifest}
                change={model.change}
                chooseBackground={() => model.setPicker('background')}
                importBackground={() => model.backgroundInput.current?.click()}
              />
            </fieldset>
          )}
        </div>
        <fieldset className="px-3 pb-3" disabled={busy || model.exporting}>
          <GifFrameControls model={model} />
          <GifFrameStrip
            frames={manifest.frames}
            selectedId={playing ? sequence[playIndex % sequence.length]?.id : selected?.id}
            assets={assets}
            imageUrl={frameImageUrl}
            onSelect={model.select}
            onMove={(source, target) => {
              if (!busy && !model.exporting) model.move(source, target);
            }}
          />
        </fieldset>
      </PasteDropSurface>
      <GifMakerFooter model={model} adoption={adoption} status={exportStatus} />
    </>
  );
}
