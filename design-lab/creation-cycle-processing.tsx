import { useState } from 'react';
import { ArrowLeftIcon, HistoryIcon, ImageIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Label } from '@/renderer/components/ui/label';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { WorkbenchNavigationPane } from '@/renderer/components/workbench/WorkbenchNavigationPane';
import { cn } from '@/renderer/lib/utils';
import { cycleAssets, type CycleModel } from './creation-cycle-model';

function ProcessInput({ model }: { model: CycleModel }) {
  const operation = model.operation!;
  const asset = cycleAssets.find((item) => item.id === operation.base.assetId);
  return (
    <WorkbenchNavigationPane
      layoutKey="design-cycle-operation-input"
      label={model.copy.input}
      selectionKey="operation"
      initialWidth={300}
      minimumContentWidth={640}
    >
      <WorkbenchPaneHeader className="pl-14">
        <span className="font-semibold">{model.copy.input}</span>
      </WorkbenchPaneHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-auto p-4">
        <div>
          <div className="mb-3 text-xs text-muted-foreground">
            {asset ? model.copy.image : operation.selection ? model.copy.selectedPassage : model.copy.wholeDraft}
          </div>
          {asset ? (
            <AssetMedia asset={asset} alt={operation.base.title} className="w-full object-contain" />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-7">{operation.input}</p>
          )}
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="text-xs text-muted-foreground">{model.copy.runReferences}</div>
          {model.materials
            .filter((item) => operation.availableInputIds.includes(item.id))
            .map((material) => (
              <Label key={material.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={model.references.includes(material.id)}
                  disabled={!material.markdown && !material.asset}
                  onCheckedChange={(checked) =>
                    model.setReferences((ids) =>
                      checked ? [...new Set([...ids, material.id])] : ids.filter((id) => id !== material.id),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate">{material.title}</span>
                  {!material.markdown && !material.asset && (
                    <span className="text-xs text-muted-foreground">{model.copy.sourceUnavailable}</span>
                  )}
                </span>
              </Label>
            ))}
        </div>
      </div>
    </WorkbenchNavigationPane>
  );
}

function ProcessControls({ model }: { model: CycleModel }) {
  const copy = model.copy;
  return (
    <section className="flex w-64 shrink-0 flex-col border-r xl:w-72">
      <WorkbenchPaneHeader>
        <strong className="text-sm">{copy.process}</strong>
      </WorkbenchPaneHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
        <Label htmlFor="cycle-requirements">{copy.requirements}</Label>
        <Textarea
          id="cycle-requirements"
          value={model.requirements}
          className="min-h-40 resize-y"
          onChange={(event) => model.setRequirements(event.target.value)}
        />
        <Button className="w-full" onClick={model.previewCandidate}>
          {copy.previewCandidate}
        </Button>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start">
              <HistoryIcon className="size-4" />
              {copy.records} · {model.records.length}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2 text-xs text-muted-foreground">
            {model.records.map((record, index) => (
              <Collapsible key={index}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left">
                    {index + 1}. {record.kind === 'image' ? copy.illustrate : copy.rewrite} · {copy.recorded}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 px-3 py-2">
                  <div>{record.targetLabel}</div>
                  <div>{record.requirements}</div>
                  <div>
                    {copy.runReferences} · {record.references.length}
                  </div>
                  {record.references.map((reference) => (
                    <div key={reference.id}>{reference.title}</div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}
            {!model.records.length && copy.noRecords}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </section>
  );
}

function ImageCandidates({ model }: { model: CycleModel }) {
  return (
    <div className="grid gap-4 p-5 @min-[520px]/cycle-output:grid-cols-2">
      {cycleAssets.map((asset, index) => (
        <div key={asset.id} className="min-w-0 space-y-3">
          <Button
            variant="ghost"
            className={cn(
              'h-auto w-full rounded-sm border p-1',
              model.candidateImage === index ? 'border-selected-border bg-selected' : 'border-transparent',
            )}
            aria-label={`${model.copy.candidate} ${index + 1}`}
            aria-pressed={model.candidateImage === index}
            onClick={() => model.setCandidateImage(index)}
          >
            <AssetMedia
              asset={asset}
              alt={`${model.copy.candidate} ${index + 1}`}
              className="aspect-[4/3] w-full object-contain"
            />
          </Button>
          <div className="text-sm">
            {model.copy.candidate} {index + 1}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => model.addInput(asset.id)}
            disabled={model.inputIds.includes(asset.id)}
          >
            {model.inputIds.includes(asset.id) ? model.copy.used : model.copy.useAsReference}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ProcessingWorkspace({ model }: { model: CycleModel }) {
  const [compare, setCompare] = useState(false);
  const copy = model.copy;
  const operation = model.operation!;
  const image = operation.kind === 'image';
  const ready = image ? model.imageReady : model.candidate !== null;
  const adoptLabel = image
    ? model.output.kind === 'IMAGE'
      ? copy.updateImage
      : operation.selection
        ? copy.insertAfterSelection
        : copy.insertAtEnd
    : operation.selection
      ? copy.replacePassage
      : model.draft.channel
        ? copy.updateAdaptation
        : copy.updateOriginal;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkbenchPaneHeader>
        <Button variant="ghost" size="sm" disabled={model.busy} onClick={() => model.setOperation(null)}>
          <ArrowLeftIcon className="size-4" />
          {copy.back}
        </Button>
        <span className="truncate text-sm text-muted-foreground">{operation.targetLabel}</span>
      </WorkbenchPaneHeader>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto">
        <ProcessInput model={model} />
        <ProcessControls model={model} />
        <section className="@container/cycle-output flex min-h-0 min-w-72 flex-1 flex-col">
          <WorkbenchPaneHeader>
            <strong className="flex-1 text-sm">
              {copy.output} · {copy.candidate}
            </strong>
            {!image && ready && (
              <Button variant="ghost" size="sm" aria-pressed={compare} onClick={() => setCompare(!compare)}>
                {copy.compare}
              </Button>
            )}
          </WorkbenchPaneHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {image && ready ? (
              <ImageCandidates model={model} />
            ) : !image && ready ? (
              <div className="space-y-5 p-5">
                {compare && (
                  <div className="border-l-2 pl-4">
                    <div className="mb-2 text-xs text-muted-foreground">{copy.original}</div>
                    <p className="whitespace-pre-wrap text-sm leading-7">{operation.input}</p>
                  </div>
                )}
                <Textarea
                  aria-label={copy.candidate}
                  value={model.candidate ?? ''}
                  className="min-h-64 leading-7"
                  onChange={(event) => model.setCandidate(event.target.value)}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-44 items-center justify-center text-muted-foreground">
                {image && <ImageIcon className="size-12 opacity-30" aria-hidden="true" />}
              </div>
            )}
          </div>
          <div className="shrink-0 space-y-3 border-t p-3">
            <div className="truncate text-xs text-muted-foreground" title={operation.targetLabel}>
              {copy.adoptTarget} · {operation.targetLabel}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={!ready || model.busy} onClick={() => void model.adopt(true)}>
                {image ? copy.saveIndependentImage : copy.saveIndependent}
              </Button>
              <Button disabled={!ready || model.busy} onClick={() => void model.adopt()}>
                {adoptLabel}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
