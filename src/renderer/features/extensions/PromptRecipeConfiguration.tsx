import { useEffect, useId, useRef, useState } from 'react';
import type { BootstrapDto, WordPaletteDto } from '@/shared/contracts';
import type { PromptRecipeDefaults } from '@/shared/contracts/prompt-recipes';
import type { TaskRecipeTask } from '@/shared/contracts/task-recipe';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { SaveWordPaletteDialog } from '@/renderer/components/palette/SaveWordPaletteDialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Props {
  active: boolean;
  disabled: boolean;
  data: BootstrapDto;
  notify(message: string): void;
  onRecipesChanged(): void | Promise<void>;
}

export function PromptRecipeConfiguration({ active, disabled, data, notify, onRecipesChanged }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.recipe.task;
  const id = useId();
  const [defaults, setDefaults] = useState<PromptRecipeDefaults | null>(null);
  const [editor, setEditor] = useState<{ task: TaskRecipeTask; palette?: WordPaletteDto } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const notifyStable = useStableCallback(notify);
  const changed = useStableCallback(onRecipesChanged);
  const palettes = new Map(data.wordPalettes.map((palette) => [palette.id, palette]));

  useEffect(() => {
    if (!active) return;
    let current = true;
    setError('');
    setDefaults(null);
    void window.desktopApi
      .promptRecipesGet(data.spaceId)
      .then((result) => {
        if (current) setDefaults(result);
      })
      .catch(() => {
        if (current) setError(l.loadFailed);
      });
    return () => {
      current = false;
    };
  }, [active, data.spaceId, l.loadFailed, retry]);

  async function select(task: TaskRecipeTask, value: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await window.desktopApi.promptRecipeSelect({
        spaceId: data.spaceId,
        task,
        recipeId: value === 'builtin' ? null : value.slice('recipe:'.length),
      });
      setDefaults(next);
      notifyStable(l.saved);
    } catch {
      setError(l.saveFailed);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="grid max-w-xl gap-4" aria-busy={busy || !defaults}>
      <h2 className="text-sm font-medium">{l.defaults}</h2>
      {(['ARTICLE_COMMENT', 'IMAGE_COVER'] as const).map((task) => {
        const recipeId = defaults?.[task];
        const selected = recipeId ? palettes.get(recipeId) : undefined;
        const available = selected?.method?.task === task && selected.status !== 'ARCHIVED';
        const options = [...palettes.values()].filter(
          (palette) => palette.method?.task === task && palette.status !== 'ARCHIVED',
        );
        return (
          <div key={task} className="grid gap-2">
            <Label htmlFor={`${id}-${task}`}>{l.controls[task]}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={recipeId ? `recipe:${recipeId}` : 'builtin'}
                disabled={disabled || busy || !defaults}
                onValueChange={(value) => void select(task, value)}
              >
                <SelectTrigger id={`${id}-${task}`} className="min-w-40 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">{l.defaultMethod}</SelectItem>
                  {recipeId && !available && (
                    <SelectItem value={`recipe:${recipeId}`} disabled>
                      {l.unavailable}
                    </SelectItem>
                  )}
                  {options.map((palette) => (
                    <SelectItem key={palette.id} value={`recipe:${palette.id}`}>
                      {palette.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {available && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={(event) => {
                    editorTrigger.current = event.currentTarget;
                    setEditor({ task, palette: selected });
                  }}
                >
                  {l.edit}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={(event) => {
                  editorTrigger.current = event.currentTarget;
                  setEditor({ task });
                }}
              >
                {l.create}
              </Button>
            </div>
          </div>
        );
      })}
      {error && (
        <div className="flex items-center gap-2">
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
          {!defaults && (
            <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
              {l.retry}
            </Button>
          )}
        </div>
      )}
      {editor && (
        <SaveWordPaletteDialog
          returnFocusRef={editorTrigger}
          open
          locale={locale}
          initialTask={editor.task}
          palette={editor.palette}
          terms={[]}
          facets={[]}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onSaved={async () => {
            await changed();
          }}
          onLifecycleChanged={async () => {
            await changed();
          }}
        />
      )}
    </section>
  );
}
