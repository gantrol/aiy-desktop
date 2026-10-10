import { useEffect, useId, useState } from 'react';
import type { AssetDto, Locale, WordPaletteDto } from '@/shared/contracts';
import type { TaskRecipeTask } from '@/shared/contracts/task-recipe';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { taskRecipeCreateInput } from '@/renderer/components/palette/taskRecipeInput';

function editorValues(source?: Pick<WordPaletteDto, 'name' | 'method' | 'referenceAssets'> | null) {
  return {
    name: source?.name ?? '',
    instructions: source?.method?.instructions ?? '',
    assets: source?.referenceAssets ?? [],
  };
}

function sameAssets(left: readonly AssetDto[], right: readonly AssetDto[]) {
  return left.map((asset) => asset.id).join() === right.map((asset) => asset.id).join();
}

export function TaskRecipeEditor({
  locale,
  task,
  palette,
  onBack,
  onSaved,
  onLifecycleChanged,
  onDirtyChange,
}: {
  locale: Locale;
  task: TaskRecipeTask;
  palette?: WordPaletteDto | null;
  onBack(): void;
  onSaved(palette: WordPaletteDto, action: 'created' | 'updated'): void | Promise<void>;
  onLifecycleChanged(action: 'archived' | 'restored' | 'deleted'): void | Promise<void>;
  onDirtyChange?(dirty: boolean): void;
}) {
  const { messages } = useI18n();
  const l = messages.recipe.task;
  const e = messages.recipe.editor;
  const id = useId();
  const initial = editorValues(palette);
  const [name, setName] = useState(initial.name);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [assets, setAssets] = useState<AssetDto[]>(initial.assets);
  const [revisionId, setRevisionId] = useState(palette?.revisionId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = palette?.revisions.find((revision) => revision.id === revisionId);
  const original = editorValues(selected ?? palette);
  const dirty =
    name !== original.name || instructions !== original.instructions || !sameAssets(assets, original.assets);
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty || busy);
  }, [dirty, busy, onDirtyChange]);

  async function save(copy: boolean) {
    if (busy || !name.trim() || !instructions.trim()) return;
    setBusy(true);
    setError('');
    const source =
      copy && palette ? { recipeId: palette.id, revisionId } : (selected?.method?.source ?? palette?.method?.source);
    const input = taskRecipeCreateInput(
      task,
      locale,
      name,
      instructions,
      source,
      assets.map((asset) => asset.id),
    );
    try {
      const saved =
        palette && !copy
          ? await window.desktopApi.wordPaletteUpdate({
              ...input,
              paletteId: palette.id,
              expectedRevisionId: palette.revisionId,
              description: palette.description,
              localizations: palette.localizations,
              nameLocale: palette.nameLocale,
            })
          : await window.desktopApi.wordPaletteCreate(input);
      await onSaved(saved, palette && !copy ? 'updated' : 'created');
    } catch {
      setError(l.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!palette || busy) return;
    setBusy(true);
    try {
      const archived = palette.status !== 'ARCHIVED';
      await window.desktopApi.wordPaletteSetArchived(palette.id, archived);
      await onLifecycleChanged(archived ? 'archived' : 'restored');
      onBack();
    } catch {
      setError(l.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => (dirty ? setDiscard(true) : onBack())}>
          {e.back}
        </Button>
        <strong>{l.tasks[task]}</strong>
        {palette && (
          <Select
            value={revisionId}
            disabled={busy || dirty}
            onValueChange={(value) => {
              const revision = palette.revisions.find((item) => item.id === value);
              if (!revision?.method) return;
              setRevisionId(value);
              setName(revision.name);
              setInstructions(revision.method.instructions);
              setAssets(revision.referenceAssets);
            }}
          >
            <SelectTrigger className="ml-auto w-24" aria-label={e.revision}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {palette.revisions.map((revision) => (
                <SelectItem key={revision.id} value={revision.id}>
                  V{revision.revisionNo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Label htmlFor={`${id}-name`}>{e.name}</Label>
      <Input
        id={`${id}-name`}
        maxLength={200}
        value={name}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <Label htmlFor={`${id}-instructions`}>{l.instructions}</Label>
      <Textarea
        id={`${id}-instructions`}
        value={instructions}
        maxLength={12_000}
        disabled={busy}
        className="min-h-48 flex-1"
        onChange={(event) => setInstructions(event.target.value)}
      />
      {task === 'IMAGE_COVER' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || assets.length >= 8}
            onClick={() =>
              void window.desktopApi
                .assetsChooseReferences()
                .then((result) =>
                  setAssets((current) =>
                    [...new Map([...current, ...result.assets].map((asset) => [asset.id, asset])).values()].slice(0, 8),
                  ),
                )
                .catch(() => setError(l.saveFailed))
            }
          >
            {e.addImages}
          </Button>
          {assets.map((asset, index) => (
            <Button
              key={asset.id}
              variant="outline"
              aria-label={`${messages.dictionary.editor.removeImage} ${new Intl.NumberFormat(locale).format(index + 1)}`}
              disabled={busy}
              onClick={() => setAssets((current) => current.filter((item) => item.id !== asset.id))}
            >
              <img src={asset.mediaUrl} alt="" className="size-10 object-contain" />×
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <footer className="flex flex-wrap gap-2">
        <Button disabled={busy || !name.trim() || !instructions.trim()} onClick={() => void save(false)}>
          {l.save}
        </Button>
        {palette && (
          <>
            <Button
              variant="outline"
              disabled={busy || !name.trim() || !instructions.trim()}
              onClick={() => void save(true)}
            >
              {l.saveAs}
            </Button>
            <Button variant="outline" disabled={busy || dirty} onClick={() => void archive()}>
              {palette.status === 'ARCHIVED' ? e.restore : e.archive}
            </Button>
          </>
        )}
        {discard && (
          <>
            <span role="status" className="self-center text-sm">
              {l.unsaved}
            </span>
            <Button variant="outline" onClick={onBack}>
              {l.discard}
            </Button>
            <Button variant="outline" onClick={() => setDiscard(false)}>
              {l.keepEditing}
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
