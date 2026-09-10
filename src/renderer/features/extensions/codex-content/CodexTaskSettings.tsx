import { useId } from 'react';
import { ArrowUpRight, Folder, Settings2 } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CodexProjectPicker } from '@/renderer/features/extensions/codex-content/CodexProjectPicker';
import { CodexExecutionPicker } from '@/renderer/features/extensions/codex-content/CodexExecutionPicker';
import type { CodexContentState, CodexContentExecution, CodexProjectTarget } from '@/shared/contracts/codex-content';

export type CodexTaskSelection = { project: CodexProjectTarget } | { execution: CodexContentExecution };
export function CodexTaskSettings({
  state,
  disabled,
  open,
  onOpenChange,
  onConfigure,
  onError,
}: {
  state: CodexContentState | null;
  disabled: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfigure(selection: CodexTaskSelection): Promise<void>;
  onError(reason: unknown): void;
}) {
  const copy = useI18n().messages.desktopPetals.codex;
  const projectId = useId();
  const project = state?.project;
  const projectName = project ? (project.projectId ? project.name : copy.noProject) : copy.chooseProject;
  const modelName = state?.execution.model ?? copy.providerDefault;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={project ? 'ghost' : 'outline'}
          size="xs"
          className={
            project
              ? 'size-7 rounded-sm p-0 text-muted-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground'
              : 'gap-1.5 rounded-sm bg-transparent px-2.5 text-inherit'
          }
          disabled={disabled}
          title={`${copy.taskSettings}\n${projectName} · ${modelName}`}
          aria-label={project ? copy.taskSettings : copy.chooseProject}
        >
          {project ? <Settings2 className="size-3.5" /> : <Folder className="size-3.5" />}
          {!project && copy.chooseProject}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        aria-label={copy.taskSettings}
        className="w-72 max-w-[calc(100vw-24px)] max-h-[min(calc(100vh-24px),var(--radix-popover-content-available-height))] overflow-y-auto p-3 shadow-overlay"
      >
        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={projectId} className="text-2xs text-muted-foreground">
              {copy.noteProject}
            </Label>
            <CodexProjectPicker
              id={projectId}
              value={project ?? null}
              disabled={disabled}
              onError={onError}
              onSelect={(project) => onConfigure({ project })}
            />
          </div>
          {open && (
            <CodexExecutionPicker
              value={state?.execution ?? { model: null, effort: null }}
              disabled={disabled}
              onError={onError}
              onChange={(execution) => onConfigure({ execution })}
            />
          )}
          <div className="flex justify-end border-t pt-2">
            <Button
              variant="ghost"
              size="xs"
              className="gap-1 rounded-sm px-1.5 text-muted-foreground"
              onClick={() => void window.desktopPetals.codex.command({ kind: 'open-plugin' }).catch(onError)}
            >
              {copy.plugin}
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
