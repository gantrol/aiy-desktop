import { useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { cn } from '@/renderer/lib/utils';
import { MaterialPicker, SourceDialog } from './theme-creation-dialogs';
import { IconButton } from './theme-creation-ui';
import type { ThemeModel } from './theme-creation-model';
import type { Material, Method } from './theme-creation-types';

export function InputProcessing({ model }: { model: ThemeModel }) {
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<Material | null>(null);
  const { copy, topic } = model;
  const prep = topic.preparation;
  const busy = topic.tasks.some((item) => item.status === 'running');
  const target = topic.outputs.find((item) => item.id === prep.targetId);
  const actions = {
    article: copy.createArticle,
    outline: copy.createOutline,
    image: copy.createImage,
    rewrite: copy.rewriteAction,
  };
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label={copy.inputToggle}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold">
          {copy.input} <span className="ml-1 font-normal text-muted-foreground">{prep.inputs.length}</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setPicker(true)}>
          <PlusIcon className="size-3.5" />
          {copy.addMaterials}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3 py-2">
          {prep.inputs.map((source, index) => (
            <div className="border-b py-2 last:border-b-0" key={source.id}>
              <div className="flex items-start gap-1">
                <Button
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 justify-start whitespace-normal px-2 py-1.5 text-left font-medium"
                  onClick={() => setPreview(source)}
                >
                  {source.title}
                </Button>
                <IconButton
                  label={copy.removeInput}
                  onClick={() => model.setPreparation({ inputs: prep.inputs.filter((item) => item.id !== source.id) })}
                >
                  <XIcon className="size-3.5" />
                </IconButton>
              </div>
              <div className="flex items-center gap-1 px-2">
                <span className="mr-auto text-xs text-muted-foreground">{copy[source.kind]}</span>
                <IconButton label={copy.moveUp} disabled={index === 0} onClick={() => model.moveInput(source.id, -1)}>
                  <ArrowUpIcon className="size-3" />
                </IconButton>
                <IconButton
                  label={copy.moveDown}
                  disabled={index === prep.inputs.length - 1}
                  onClick={() => model.moveInput(source.id, 1)}
                >
                  <ArrowDownIcon className="size-3" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 px-4 pb-5 pt-2">
          <Label htmlFor="prototype-requirement">{copy.requirements}</Label>
          <Textarea
            id="prototype-requirement"
            value={prep.requirement}
            onChange={(event) => model.setPreparation({ requirement: event.target.value })}
            placeholder={copy.requirementsPlaceholder}
            className="min-h-24 resize-y bg-surface"
          />
        </div>
        <div className="space-y-4 border-t p-4">
          <h2 className="text-sm font-semibold">{copy.processing}</h2>
          <div className="flex items-center justify-between gap-3">
            <Label>{copy.method}</Label>
            <Select
              value={prep.method}
              onValueChange={(value) =>
                model.setPreparation({ method: value as Method, targetId: null, baseRevision: null })
              }
            >
              <SelectTrigger className="h-8 w-40 bg-surface" aria-label={copy.method}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['article', 'outline', 'image'] as const).map((method) => (
                  <SelectItem value={method} key={method}>
                    {actions[method]}
                  </SelectItem>
                ))}
                {prep.method === 'rewrite' && <SelectItem value="rewrite">{copy.rewrite}</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start justify-between gap-3 text-xs">
            <span className="shrink-0 text-muted-foreground">{copy.resultTarget}</span>
            <span className="text-right font-medium">
              {target?.title ?? `${copy.newResult} · ${copy[prep.method === 'rewrite' ? 'article' : prep.method]}`}
            </span>
          </div>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                <ChevronDownIcon className="size-3.5" />
                {copy.parameters}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-3 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span>{copy.model}</span>
                <span>{copy.simulatedModel}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>{copy.tone}</span>
                <Select
                  value={prep.tone}
                  onValueChange={(tone) => model.setPreparation({ tone: tone as 'natural' | 'concise' })}
                >
                  <SelectTrigger className="h-8 w-28" aria-label={copy.tone}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="natural">{copy.natural}</SelectItem>
                    <SelectItem value="concise">{copy.concise}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Button
            className="w-full"
            disabled={busy || (!prep.inputs.length && !prep.requirement.trim())}
            onClick={model.run}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {busy ? copy.running : actions[prep.method]}
          </Button>
          {topic.previous.length > 0 && (
            <Button variant="ghost" size="xs" onClick={model.restorePreparation}>
              <HistoryIcon className="size-3.5" />
              {copy.previousProcess}
            </Button>
          )}
        </div>
        {topic.tasks.length > 0 && (
          <div className="border-t p-4">
            <h3 className="mb-3 text-xs text-muted-foreground">{copy.tasks}</h3>
            {topic.tasks
              .slice()
              .reverse()
              .map((job) => (
                <Button
                  key={job.id}
                  variant="ghost"
                  className={cn(
                    'mb-1 h-auto w-full justify-between gap-2 px-2 py-2 text-xs',
                    topic.viewingTask === job.id && 'bg-surface-sunken',
                  )}
                  onClick={() => model.viewTask(job.id)}
                >
                  <span className="min-w-0 truncate">{job.title}</span>
                  <span className="shrink-0 text-muted-foreground">{copy[job.status]}</span>
                </Button>
              ))}
          </div>
        )}
      </div>
      {picker && <MaterialPicker model={model} close={() => setPicker(false)} />}
      {preview && <SourceDialog model={model} sources={[preview]} close={() => setPreview(null)} />}
    </section>
  );
}
