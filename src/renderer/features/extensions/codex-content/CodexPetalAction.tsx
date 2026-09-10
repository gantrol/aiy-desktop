import { useCallback, useRef, useState } from 'react';
import { LoaderCircle, Play, Square } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import {
  CodexTaskSettings,
  type CodexTaskSelection,
} from '@/renderer/features/extensions/codex-content/CodexTaskSettings';
import { CodexTaskStatus } from '@/renderer/features/extensions/codex-content/CodexTaskStatus';
import { codexContentError, isContentTaskActive } from '@/renderer/features/extensions/codex-content/use-codex-content';
import { useCodexNoteContent } from '@/renderer/features/extensions/codex-content/CodexNoteContext';

export function CodexPetalAction({
  note,
  prepare,
  disabled,
}: {
  note: DesktopNote;
  prepare(): Promise<DesktopNote | null>;
  disabled: boolean;
}) {
  const copy = useI18n().messages.desktopPetals.codex;
  const { state, error: loadError, refresh } = useCodexNoteContent();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<{ id: string; hash: string } | null>(null);
  const onError = useCallback((reason: unknown) => setError(reason), []);
  const latest = state?.tasks[0];
  const running = latest && isContentTaskActive(latest.status);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    void run(async () => {
      const saved = await prepare();
      if (!saved?.persisted) return;
      if (!request.current || request.current.hash !== saved.contentHash)
        request.current = { id: crypto.randomUUID(), hash: saved.contentHash };
      await window.desktopPetals.codex.command({
        kind: 'start',
        stashId: saved.stashId,
        requestId: request.current.id,
        expectedHash: saved.contentHash,
      });
      request.current = null;
      setSettingsOpen(false);
    });
  const configure = async (selection: CodexTaskSelection) => {
    setBusy(true);
    try {
      const saved = await prepare();
      if (!saved?.persisted) throw new Error('[aiy-codex-content:empty]');
      await window.desktopPetals.codex.command(
        'project' in selection
          ? { kind: 'select-project', stashId: saved.stashId, project: selection.project }
          : { kind: 'select-execution', stashId: saved.stashId, execution: selection.execution },
      );
      request.current = null;
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          {latest && (
            <CodexTaskStatus
              task={latest}
              busy={busy}
              compact
              onAction={(kind) =>
                void run(() =>
                  window.desktopPetals.codex.command(
                    kind === 'open-album'
                      ? { kind: 'open-task-album', stashId: note.stashId, taskId: latest.id }
                      : { kind, stashId: note.stashId, taskId: latest.id },
                  ),
                )
              }
            />
          )}
        </div>
        <CodexTaskSettings
          state={state}
          disabled={busy || disabled || !!running || !note.editable}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onConfigure={configure}
          onError={onError}
        />
        {running && latest ? (
          <Button
            variant="outline"
            size="xs"
            className="gap-1.5 rounded-sm border-current/20 bg-transparent px-2.5 text-inherit"
            disabled={busy}
            aria-busy={busy}
            onClick={() =>
              void run(() =>
                window.desktopPetals.codex.command({ kind: 'stop', stashId: note.stashId, taskId: latest.id }),
              )
            }
          >
            {busy ? <LoaderCircle className="size-3 motion-safe:animate-spin" /> : <Square className="size-3" />}
            {copy.stop}
          </Button>
        ) : (
          state?.project && (
            <Button
              variant="secondary"
              size="xs"
              className="gap-1.5 rounded-sm bg-foreground px-2.5 text-background hover:bg-foreground/85 active:bg-foreground/75"
              disabled={busy || disabled || !note.editable}
              aria-busy={busy}
              onClick={() => start()}
            >
              {busy ? <LoaderCircle className="size-3 motion-safe:animate-spin" /> : <Play className="size-3" />}
              {copy.execute}
            </Button>
          )
        )}
      </div>
      {Boolean(error || loadError) && (
        <div className="px-1 pt-1.5 text-xs break-words text-destructive" role="alert">
          {codexContentError(error || loadError, copy)}
        </div>
      )}
    </div>
  );
}
