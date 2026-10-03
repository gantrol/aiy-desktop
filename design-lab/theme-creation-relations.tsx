import { useState } from 'react';
import { ArrowLeftIcon, ArrowUpRightIcon, GitCompareArrowsIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { Cover, IconButton, kindIcons } from './theme-creation-ui';
import { findSource, type Material } from './theme-creation-types';
import type { ThemeModel } from './theme-creation-model';

function SourceComparison({
  source,
  model,
  close,
  showInputs,
  onNavigate,
}: {
  source: Material;
  model: ThemeModel;
  close(): void;
  showInputs(): void;
  onNavigate?(): void;
}) {
  const { copy } = model;
  const current = findSource(model.data.topics, source);
  const changed = current && current.output.revision !== source.outputRevision;
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col rounded-md" aria-describedby={undefined}>
        <DialogTitle>{source.title}</DialogTitle>
        <div className={`grid min-h-0 flex-1 gap-6 overflow-auto ${source.outputId ? 'sm:grid-cols-2' : ''}`}>
          <section>
            <h3 className="mb-3 text-xs font-semibold text-muted-foreground">{copy.usedSource}</h3>
            {source.image !== undefined && <Cover title={source.title} variant={source.image} copy={copy} />}
            <div className="whitespace-pre-wrap text-sm leading-7">{source.body}</div>
          </section>
          {source.outputId && (
            <section className="border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
              <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
                {copy.currentSource} ·{' '}
                {current ? (changed ? copy.sourceChanged : copy.sourceUnchanged) : copy.sourceMissing}
              </h3>
              {current && (
                <>
                  <h4 className="mb-3 text-sm font-semibold">{current.output.title}</h4>
                  {current.output.kind === 'image' && (
                    <Cover title={current.output.title} variant={current.output.image} copy={copy} />
                  )}
                  <div className="whitespace-pre-wrap text-sm leading-7">{current.output.body}</div>
                </>
              )}
            </section>
          )}
        </div>
        {current && (
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                close();
                model.followSource(source);
                onNavigate?.();
              }}
            >
              {copy.openSource}
              <ArrowUpRightIcon className="size-3.5" />
            </Button>
            {changed && (
              <Button
                onClick={() => {
                  close();
                  model.prepareFromSources();
                  showInputs();
                }}
              >
                {copy.reprocessSource}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OutputConnections({
  model,
  showInputs,
  onNavigate,
}: {
  model: ThemeModel;
  showInputs(): void;
  onNavigate?(): void;
}) {
  const { copy, output, topic } = model;
  const [preview, setPreview] = useState<Material | null>(null);
  const derived = model.data.topics.flatMap((owner) =>
    owner.outputs
      .filter(
        (work) =>
          work.id !== output.id &&
          work.sources.some(
            (source) => source.outputId === output.id && (!source.topicId || source.topicId === topic.id),
          ),
      )
      .map((work) => ({ owner, work })),
  );
  if (!output.sources.length && !derived.length) return null;
  return (
    <div className="space-y-5 border-t px-3 py-4">
      {!!output.sources.length && (
        <section>
          <h3 className="mb-2 px-2 text-xs text-muted-foreground">{copy.sourceLinks}</h3>
          {output.sources.map((source) => {
            const current = findSource(model.data.topics, source);
            const changed = current && current.output.revision !== source.outputRevision;
            return (
              <div key={source.id} className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto min-w-0 flex-1 flex-col items-start gap-1 py-2 text-left"
                  onClick={() => {
                    if (current) {
                      model.followSource(source);
                      onNavigate?.();
                    } else setPreview(source);
                  }}
                >
                  <span className="w-full truncate">{current?.output.title ?? source.title}</span>
                  {changed && <span className="text-xs font-normal text-warning">{copy.sourceChanged}</span>}
                  {source.outputId && !current && (
                    <span className="text-xs font-normal text-muted-foreground">{copy.sourceMissing}</span>
                  )}
                </Button>
                {source.outputId && (
                  <IconButton label={copy.compareSource} onClick={() => setPreview(source)}>
                    <GitCompareArrowsIcon className="size-3.5" />
                  </IconButton>
                )}
              </div>
            );
          })}
        </section>
      )}
      {!!derived.length && (
        <section>
          <h3 className="mb-2 px-2 text-xs text-muted-foreground">{copy.derivedOutputs}</h3>
          {derived.map(({ owner, work }) => {
            const Icon = kindIcons[work.kind];
            return (
              <Button
                key={work.id}
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  model.navigate({ topicId: owner.id, outputId: work.id });
                  onNavigate?.();
                }}
              >
                <Icon className="size-3.5" />
                <span className="truncate">{work.title}</span>
              </Button>
            );
          })}
        </section>
      )}
      {preview && (
        <SourceComparison
          source={preview}
          model={model}
          close={() => setPreview(null)}
          showInputs={showInputs}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

export function ReturnToWork({ model }: { model: ThemeModel }) {
  if (!model.returnTarget) return null;
  const target = model.data.topics
    .find((item) => item.id === model.returnTarget?.topicId)
    ?.outputs.find((item) => item.id === model.returnTarget?.outputId);
  if (!target || target.id === model.output.id) return null;
  return (
    <Button variant="ghost" size="sm" className="min-w-0 max-w-64" onClick={model.returnToWork}>
      <ArrowLeftIcon className="size-3.5" />
      <span className="truncate">
        {model.copy.returnWork} {target.title}
      </span>
    </Button>
  );
}
