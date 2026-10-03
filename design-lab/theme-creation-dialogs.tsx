import { useState } from 'react';
import { CheckIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { cn } from '@/renderer/lib/utils';
import { Cover } from './theme-creation-ui';
import type { ThemeModel } from './theme-creation-model';
import type { Material, Platform } from './theme-creation-types';

export function MaterialPicker({ model, close }: { model: ThemeModel; close(): void }) {
  const { copy, materials } = model;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState(materials[0]?.id);
  const preview = materials.find((item) => item.id === previewId);
  const filtered = materials.filter(
    (item) =>
      (category === 'all' || item.kind === category) &&
      `${item.title} ${item.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex h-[min(660px,90dvh)] max-w-4xl flex-col gap-0 rounded-md p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="border-b px-5 py-4 text-base">{copy.addMaterials}</DialogTitle>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <SearchIcon className="size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={copy.searchMaterials}
            placeholder={copy.searchMaterials}
            className="h-8 flex-1"
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 w-28" aria-label={copy.all}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['all', 'comments', 'notes', 'images', 'outputs'] as const).map((key) => (
                <SelectItem key={key} value={key}>
                  {copy[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[45%_1fr]">
          <div className="overflow-auto border-r p-2">
            {filtered.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'flex items-start gap-2 rounded-sm px-2 py-1',
                  previewId === item.id && 'bg-surface-sunken',
                )}
              >
                <Checkbox
                  className="mt-3"
                  aria-label={item.title}
                  checked={selected.includes(item.id)}
                  onCheckedChange={(checked) =>
                    setSelected((ids) => (checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)))
                  }
                />
                <Button
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 flex-col items-start gap-1 whitespace-normal py-2 text-left"
                  onClick={() => setPreviewId(item.id)}
                >
                  <span>{item.title}</span>
                  <span className="text-xs font-normal text-muted-foreground">{copy[item.kind]}</span>
                </Button>
              </div>
            ))}
            {!filtered.length && <div className="p-5 text-sm text-muted-foreground">{copy.noMatches}</div>}
          </div>
          <div className="hidden overflow-auto p-5 sm:block">
            {preview && <SourceContent source={preview} model={model} />}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t p-4">
          <span className="text-xs text-muted-foreground">
            {copy.selected} {selected.length}
          </span>
          <Button
            disabled={!selected.length}
            onClick={() => {
              model.addInputs(materials.filter((item) => selected.includes(item.id)));
              close();
            }}
          >
            {copy.addSelected} {selected.length || ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function SourceContent({ source, model }: { source: Material; model: ThemeModel }) {
  return (
    <>
      <h3 className="mb-4 text-base font-semibold">{source.title}</h3>
      {source.image !== undefined && <Cover title={source.title} variant={source.image} copy={model.copy} />}
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{source.body}</p>
    </>
  );
}
export function SourceDialog({ sources, model, close }: { sources: Material[]; model: ThemeModel; close(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-2xl rounded-md" aria-describedby={undefined}>
        <DialogTitle>{model.copy.sources}</DialogTitle>
        <div className="space-y-8">
          {sources.map((source) => (
            <section key={source.id}>
              <SourceContent source={source} model={model} />
            </section>
          ))}
          {!sources.length && model.copy.noSources}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function PublishDialog({ model, close }: { model: ThemeModel; close(): void }) {
  const { copy, output } = model;
  const [platform, setPlatform] = useState<Platform>('wechat');
  const draft = model.platformDraft(platform);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex h-[min(740px,94dvh)] max-w-3xl flex-col rounded-md" aria-describedby={undefined}>
        <DialogTitle>
          {copy.publication} · {output.title}
        </DialogTitle>
        <div className="flex flex-wrap items-center gap-3 border-y py-3">
          <Label>{copy.platform}</Label>
          <Select
            value={platform}
            onValueChange={(value) => {
              const next = value as Platform;
              model.editPlatform(next, {});
              setPlatform(next);
            }}
          >
            <SelectTrigger className="w-40" aria-label={copy.platform}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wechat">{copy.wechat}</SelectItem>
              <SelectItem value="rednote">{copy.rednote}</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {copy.account} · {copy.demoAccount}
          </span>
        </div>
        {draft.sourceRevision !== output.revision && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-warning">
            <span>{copy.sourceUpdated}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                model.editPlatform(platform, {
                  title: output.title,
                  body: output.body,
                  sourceRevision: output.revision,
                  sent: false,
                })
              }
            >
              {copy.refreshPlatform}
            </Button>
          </div>
        )}
        <Input
          value={draft.title}
          aria-label={copy.outputTitle}
          onChange={(event) => model.editPlatform(platform, { title: event.target.value, sent: false })}
        />
        <Textarea
          value={draft.body}
          aria-label={copy.platformBody}
          className="min-h-40 flex-1 resize-none leading-7"
          onChange={(event) => model.editPlatform(platform, { body: event.target.value, sent: false })}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" onClick={close}>
            {copy.returnOriginal}
          </Button>
          {draft.sent ? (
            <span role="status" className="flex items-center gap-2 text-sm text-success">
              <CheckIcon className="size-4" />
              {copy.handedOff}
            </span>
          ) : (
            <Button
              disabled={!draft.body.trim() && output.kind !== 'image'}
              onClick={() => model.editPlatform(platform, { sent: true })}
            >
              {copy.handoff}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function HistoryDialog({ model, close }: { model: ThemeModel; close(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-2xl rounded-md" aria-describedby={undefined}>
        <DialogTitle>
          {model.copy.history} · {model.output.title}
        </DialogTitle>
        {model.output.versions.map((version, index) => (
          <section key={index} className="border-t pt-4">
            <div className="mb-3 text-xs text-muted-foreground">
              {model.copy.version} {index + 1}
            </div>
            <h3 className="mb-3 font-semibold">{version.title}</h3>
            {model.output.kind === 'image' ? (
              <Cover title={version.title} variant={version.image} copy={model.copy} />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-7">{version.body}</p>
            )}
          </section>
        ))}
        {!model.output.versions.length && model.copy.noHistory}
      </DialogContent>
    </Dialog>
  );
}
