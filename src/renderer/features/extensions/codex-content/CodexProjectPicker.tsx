import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Folder, RefreshCw } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CodexProjectTarget } from '@/shared/contracts/codex-content';

export function CodexProjectPicker({
  id,
  value,
  disabled,
  onSelect,
  onError,
  initialOpen = false,
  actions,
}: {
  id?: string;
  value: CodexProjectTarget | null;
  disabled?: boolean;
  initialOpen?: boolean;
  actions?: ReactNode;
  onSelect(value: CodexProjectTarget): Promise<void>;
  onError(reason: unknown): void;
}) {
  const copy = useI18n().messages.desktopPetals.codex;
  const [open, setOpen] = useState(initialOpen),
    [query, setQuery] = useState('');
  const [projects, setProjects] = useState<CodexProjectTarget[]>([]);
  const [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    void window.desktopPetals.codex
      .projects(version > 0)
      .then((items) => {
        if (live) setProjects(items);
      })
      .catch((reason) => {
        if (live) onError(reason);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, version, onError]);
  const choose = async (project: CodexProjectTarget) => {
    setLoading(true);
    try {
      await onSelect(project);
      setOpen(false);
    } catch (reason) {
      onError(reason);
    } finally {
      setLoading(false);
    }
  };
  const choices = [{ projectId: null, name: copy.noProject, workspace: '' }, ...projects].filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size="sm"
          disabled={disabled}
          className="min-w-0 w-full justify-start gap-2 rounded-sm text-inherit"
          title={value?.name || copy.chooseProject}
        >
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {value ? (value.projectId ? value.name : copy.noProject) : copy.chooseProject}
          </span>
          <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-32px)] max-h-[min(calc(100vh-24px),var(--radix-popover-content-available-height))] overflow-y-auto p-2 shadow-overlay"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex gap-1">
          <Input
            className="h-8 rounded-sm text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchProjects}
            aria-label={copy.searchProjects}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-sm text-muted-foreground"
            disabled={loading}
            aria-label={copy.refresh}
            title={copy.refresh}
            onClick={() => setVersion((n) => n + 1)}
          >
            <RefreshCw className={`size-3.5${loading ? ' motion-safe:animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="mt-1 max-h-40 overflow-y-auto" aria-busy={loading}>
          {choices.map((project) => (
            <Button
              key={project.projectId ?? 'none'}
              variant="ghost"
              size="sm"
              className="h-auto min-h-8 w-full justify-start gap-2 rounded-sm py-1 text-left text-xs aria-pressed:bg-selected"
              disabled={loading}
              aria-pressed={Boolean(value && value.projectId === project.projectId)}
              title={project.workspace || project.name}
              onClick={() => void choose(project)}
            >
              <Folder className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {value && value.projectId === project.projectId && <Check className="size-3" />}
            </Button>
          ))}
          {!loading && projects.length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground" role="status">
              {copy.emptyProjects}
            </div>
          )}
        </div>
        {actions && <div className="mt-1 flex flex-wrap gap-1 border-t pt-1">{actions}</div>}
      </PopoverContent>
    </Popover>
  );
}
