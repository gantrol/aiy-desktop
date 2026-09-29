import { useState } from 'react';
import { FileTextIcon, ImageIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { WorkbenchNavigationPane } from '@/renderer/components/workbench/WorkbenchNavigationPane';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ContentInput } from '@/renderer/features/content-editor/ContentInput';
import { cn } from '@/renderer/lib/utils';
import type { CycleMaterial, CycleModel } from './creation-cycle-model';

export function SourcePreview({ material, model }: { material: CycleMaterial; model: CycleModel }) {
  return (
    <div className="min-w-0 p-5">
      <h2 className="text-lg font-semibold leading-relaxed">{material.title}</h2>
      <div className="mt-2 mb-6 text-xs text-muted-foreground">{material.author}</div>
      {material.asset ? (
        <AssetMedia asset={material.asset} alt={material.title} className="max-h-96 w-full object-contain" />
      ) : material.markdown ? (
        <ContentInput
          key={material.id}
          markdown={material.markdown}
          sessionIdentity={`cycle-source-${material.id}`}
          assets={[]}
          readOnly
          toolbarVisible={false}
          onChange={() => undefined}
          onSave={() => undefined}
          onError={() => model.setNotice(model.copy.sourceMissing)}
        />
      ) : (
        <div role="status" className="text-sm text-muted-foreground">
          {model.copy.sourceMissing}
        </div>
      )}
    </div>
  );
}

function MaterialRow({ material, model, onSelect }: { material: CycleMaterial; model: CycleModel; onSelect(): void }) {
  const Icon = material.kind === 'IMAGE' ? ImageIcon : FileTextIcon;
  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto w-full justify-start rounded-sm px-3 py-3 text-left',
        model.selectedMaterialId === material.id && 'bg-selected text-selected-foreground',
      )}
      onClick={onSelect}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{material.title}</span>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {material.kind === 'IMAGE' ? model.copy.image : model.copy.article} · {material.author}
        </span>
      </span>
    </Button>
  );
}

export function MaterialBrowser({ model, onUse }: { model: CycleModel; onUse?(): void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('ALL');
  const { copy } = model;
  const selected = model.materials.find((item) => item.id === model.selectedMaterialId) ?? model.materials[0];
  const filtered = model.materials.filter(
    (item) => (kind === 'ALL' || item.kind === kind) && item.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b p-3">
        <Input
          className="w-64"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.query}
          aria-label={copy.query}
        />
        <Segmented type="single" value={kind} onValueChange={(value) => value && setKind(value)}>
          <SegmentedItem value="ALL">{copy.all}</SegmentedItem>
          <SegmentedItem value="ARTICLE">{copy.article}</SegmentedItem>
          <SegmentedItem value="IMAGE">{copy.image}</SegmentedItem>
        </Segmented>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="max-h-56 shrink-0 overflow-auto border-b p-2 md:max-h-none md:w-80 md:border-r md:border-b-0">
          {filtered.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              model={model}
              onSelect={() => model.setSelectedMaterialId(material.id)}
            />
          ))}
          {!filtered.length && <div className="p-3 text-sm text-muted-foreground">{copy.noMatches}</div>}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <SourcePreview material={selected} model={model} />
          </div>
          <div className="flex shrink-0 justify-end border-t p-3">
            <Button
              onClick={() => {
                model.addInput(selected.id);
                onUse?.();
              }}
              disabled={model.inputIds.includes(selected.id)}
            >
              {model.inputIds.includes(selected.id) ? copy.used : copy.useInDraft}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InputPicker({ model }: { model: CycleModel }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={model.copy.addInput} title={model.copy.addInput}>
          <PlusIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(720px,90dvh)] max-w-5xl flex-col gap-0 p-0" aria-describedby={undefined}>
        <DialogTitle className="shrink-0 border-b p-4 text-base">{model.copy.addInput}</DialogTitle>
        <MaterialBrowser model={model} onUse={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function DraftInputPane({ model }: { model: CycleModel }) {
  const [preview, setPreview] = useState(false);
  const [toggleHost, setToggleHost] = useState<HTMLDivElement | null>(null);
  const selected = model.materials.find((item) => item.id === model.selectedMaterialId);
  return (
    <>
      <div className="flex w-10 shrink-0 flex-col items-center border-r pt-3" ref={setToggleHost} />
      <WorkbenchNavigationPane
        layoutKey="design-cycle-input"
        label={model.copy.input}
        selectionKey="draft"
        initialWidth={300}
        minimumContentWidth={600}
        toggleHost={toggleHost}
      >
        <WorkbenchPaneHeader>
          <span className="flex-1 text-sm font-semibold">
            {model.copy.input} · {model.copy.thisDraft}
          </span>
          <InputPicker model={model} />
        </WorkbenchPaneHeader>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {model.materials
            .filter((item) => model.inputIds.includes(item.id))
            .map((material) => (
              <div key={material.id} className="flex items-center">
                <MaterialRow
                  material={material}
                  model={model}
                  onSelect={() => {
                    model.setSelectedMaterialId(material.id);
                    setPreview(true);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={model.copy.removeInput}
                  onClick={() => model.setInputIds((ids) => ids.filter((id) => id !== material.id))}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            ))}
          {!model.inputIds.length && <div className="p-3 text-xs text-muted-foreground">{model.copy.noInputs}</div>}
        </div>
        {selected && preview && (
          <div className="max-h-[55%] overflow-auto border-t">
            <div className="flex items-center justify-between px-4 pt-2">
              <span className="text-xs text-muted-foreground">{model.copy.sourcePreview}</span>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="xs">
                    {model.copy.openSource}
                  </Button>
                </DialogTrigger>
                <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col" aria-describedby={undefined}>
                  <DialogTitle>{model.copy.source}</DialogTitle>
                  <div className="overflow-auto">
                    <SourcePreview material={selected} model={model} />
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <SourcePreview material={selected} model={model} />
          </div>
        )}
      </WorkbenchNavigationPane>
    </>
  );
}
