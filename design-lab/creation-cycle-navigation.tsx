import { useState } from 'react';
import { FileTextIcon, HistoryIcon, ImageIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { sameDraft } from './creation-cycle-documents';
import { cycleAssets, type CycleModel } from './creation-cycle-model';

export function OutputNavigation({ model }: { model: CycleModel }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
      <div className="px-3 pb-2 text-xs text-muted-foreground">{model.copy.outputs}</div>
      {model.outputs.map((output) => {
        const Icon = output.kind === 'IMAGE' ? ImageIcon : FileTextIcon;
        return (
          <Button
            key={output.id}
            variant={model.surface === 'write' && model.target.outputId === output.id ? 'secondary' : 'ghost'}
            className="mb-1 h-auto w-full items-start justify-start rounded-sm px-3 py-3 text-left"
            disabled={model.busy || Boolean(model.operation)}
            onClick={() => void model.switchDraft(output.id)}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block whitespace-normal leading-5">{output.drafts[0].title}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {output.derivedFrom
                  ? model.copy.independentDraft
                  : output.kind === 'IMAGE'
                    ? model.copy.image
                    : model.copy.article}
                {output.drafts.length > 1 && ` · ${model.copy.adaptations} ${output.drafts.length - 1}`}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function RevisionHistory({ model }: { model: CycleModel }) {
  const [selected, setSelected] = useState(model.draft.history.length - 1);
  const snapshot = model.draft.history[selected] ?? model.draft.history[0];
  const asset = cycleAssets.find((item) => item.id === snapshot.assetId);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" onClick={() => setSelected(model.draft.history.length - 1)}>
          <HistoryIcon className="size-4" />
          {model.copy.history}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80dvh] max-w-3xl flex-col" aria-describedby={undefined}>
        <DialogTitle>
          {model.copy.history} · {model.contextLabel}
        </DialogTitle>
        <div className="flex min-h-0 gap-5 overflow-hidden">
          <div className="w-24 shrink-0 space-y-1 overflow-auto">
            {model.draft.history.map((_, index) => (
              <Button
                key={index}
                variant={selected === index ? 'secondary' : 'ghost'}
                className="w-full"
                onClick={() => setSelected(index)}
              >
                r{index + 1}
              </Button>
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-4 overflow-auto py-2">
            <h3 className="font-semibold">{snapshot.title}</h3>
            {asset ? (
              <AssetMedia asset={asset} alt={snapshot.title} className="max-h-80 w-full object-contain" />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-7">{snapshot.markdown}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditingContextBar({ model }: { model: CycleModel }) {
  const original = model.output.drafts[0];
  const source = model.draft.sourceRevision ? original.history[model.draft.sourceRevision - 1] : null;
  const sourceChanged = source && !sameDraft(original, source);
  const parent = model.output.derivedFrom;
  return (
    <WorkbenchPaneHeader className="h-auto flex-wrap gap-x-3 gap-y-2 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{model.output.drafts[0].title}</span>
      {model.output.drafts.length > 1 ? (
        <Select
          value={model.target.draftId}
          onValueChange={(id) => void model.switchDraft(model.output.id, id)}
          disabled={model.busy}
        >
          <SelectTrigger className="h-8 w-44" aria-label={model.copy.editingDraft}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {model.output.drafts.map((draft) => (
              <SelectItem key={draft.id} value={draft.id}>
                {draft.channel ? model.copy[draft.channel] : model.copy.original}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs text-muted-foreground">{model.contextLabel}</span>
      )}
      <span className="text-xs text-muted-foreground">
        r{model.draft.history.length}
        {model.dirty && ` · ${model.copy.unsavedRevision}`}
      </span>
      <Button variant="ghost" size="sm" disabled={model.busy} onClick={() => void model.saveRevision()}>
        {model.copy.saveRevision}
      </Button>
      <RevisionHistory key={model.contextKey} model={model} />
      {(source || parent) && (
        <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
          {source && (
            <>
              <span>
                {model.copy.basedOnOriginal} r{model.draft.sourceRevision}
              </span>
              {sourceChanged && <span>{model.copy.originalChanged}</span>}
            </>
          )}
          {parent && (
            <>
              <span>{model.copy.derivedFrom}</span>
              <Button
                variant="link"
                size="xs"
                disabled={model.busy}
                onClick={() => void model.switchDraft(parent.outputId, parent.draftId)}
              >
                {parent.snapshot.title}
              </Button>
            </>
          )}
        </div>
      )}
    </WorkbenchPaneHeader>
  );
}
