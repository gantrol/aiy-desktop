import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MaintenanceProject } from '@/shared/contracts/maintenance-guide';
import {
  projectCommandGroups,
  type ProjectCommand,
  type ProjectCommandScan,
} from '@/shared/contracts/project-commands';
import { mergeProjectCommands } from '@/shared/project-commands';
import { ProjectCommandEditor } from '@/renderer/features/maintenance-guide/ProjectCommandEditor';
import { useProjectCommandDraft } from '@/renderer/features/maintenance-guide/project-command-drafts';

export function ProjectCommands({
  project,
  busy,
  canScan,
  onScan,
  onSave,
}: {
  project: MaintenanceProject;
  busy: boolean;
  canScan: boolean;
  onScan(requestId: string, chooseDirectory: boolean, accept: (scan: ProjectCommandScan) => void): Promise<boolean>;
  onSave(commands: ProjectCommand[]): Promise<boolean>;
}) {
  const l = useI18n().messages.maintenanceGuide;
  const c = l.commands;
  const request = useRef<string | null>(null);
  const mounted = useRef(true);
  const [scanning, setScanning] = useState(false);
  const { candidates, issues, group, editing, set } = useProjectCommandDraft(project.id);
  const setCandidates = (value: ProjectCommand[] | null) => set('candidates', value);
  const setIssues = (value: ProjectCommandScan['issues']) => set('issues', value);
  const setGroup = (value: ProjectCommand['group']) => set('group', value);
  const setEditing = (value: ProjectCommand | null) => set('editing', value);
  const [copyStatus, setCopyStatus] = useState('');
  const commands = candidates ?? project.commands ?? [];
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (request.current)
        void window.desktopApi.maintenanceGuide
          .cancelCommandScan({ requestId: request.current })
          .catch(() => undefined);
    };
  }, []);
  const scan = async (chooseDirectory: boolean) => {
    if (request.current) return;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setScanning(true);
    try {
      await onScan(requestId, chooseDirectory, (result) => {
        if (!mounted.current || request.current !== requestId) return;
        setCandidates(mergeProjectCommands(project.commands ?? [], result.commands, result.issues.length === 0));
        setIssues(result.issues);
      });
    } finally {
      request.current = null;
      if (mounted.current) setScanning(false);
    }
  };
  const save = async (next: ProjectCommand[]) => {
    if (candidates) {
      setCandidates(next);
      return true;
    }
    return onSave(next);
  };
  return (
    <div className="grid gap-3 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canScan || Boolean(candidates)}
          onClick={() => void scan(true)}
        >
          {c.chooseDirectory}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canScan || !project.commandDirectory || Boolean(candidates)}
          onClick={() => void scan(false)}
        >
          {c.rescan}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || commands.length >= 256}
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              name: '',
              command: '',
              directory: project.commandDirectory ?? '',
              source: '',
              fingerprint: '',
              tool: '',
              group,
              shell: window.desktopApi.appPlatform === 'win32' ? 'powershell' : 'posix',
              platform: 'any',
              origin: 'manual',
              status: 'incomplete',
              edited: true,
              detail: '',
            })
          }
        >
          {c.add}
        </Button>
        {scanning && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (request.current)
                void window.desktopApi.maintenanceGuide.cancelCommandScan({ requestId: request.current });
            }}
          >
            {l.cancel}
          </Button>
        )}
      </div>
      {!canScan && (
        <div role="status" className="text-xs text-muted-foreground">
          {l.errors.permissionRequired}
        </div>
      )}
      {project.commandDirectory && <div className="break-all font-mono text-xs">{project.commandDirectory}</div>}
      {scanning && <div role="status">{c.scanning}</div>}
      {candidates && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{c.candidates}</span>
          <Button
            size="sm"
            disabled={busy || candidates.length > 256}
            onClick={() =>
              void onSave(candidates).then((saved) => {
                if (saved) {
                  setCandidates(null);
                  setIssues([]);
                }
              })
            }
          >
            {c.adopt}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setCandidates(null);
              setIssues([]);
            }}
          >
            {c.discard}
          </Button>
        </div>
      )}
      {commands.length > 256 && (
        <div role="alert" className="text-sm text-destructive">
          {c.limit}
        </div>
      )}
      {issues.length > 0 && (
        <ul className="max-h-32 overflow-auto text-xs text-muted-foreground">
          {issues.map((issue, index) => (
            <li key={`${issue.path}-${index}`}>
              {c.issues[issue.code]} · {issue.path || '.'}
            </li>
          ))}
        </ul>
      )}
      <Tabs value={group} onValueChange={(value) => setGroup(value as ProjectCommand['group'])}>
        <TabsList>
          {projectCommandGroups.map((key) => (
            <TabsTrigger value={key} key={key}>
              {c.groups[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div role="status" className="text-xs text-muted-foreground">
        {copyStatus || c.environmentUnchecked}
      </div>
      {commands.filter((command) => command.group === group).length === 0 && (
        <div className="py-4 text-sm text-muted-foreground">{c.empty}</div>
      )}
      <ul className="divide-y">
        {commands
          .filter((command) => command.group === group)
          .map((command) => (
            <li key={command.id} className="grid gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{command.name}</strong>
                {command.operation && <span className="text-xs">{c.operations[command.operation]}</span>}
                <span className="text-xs text-muted-foreground">
                  {c.statuses[command.status]} · {c.origins[command.origin]} · {c.platforms[command.platform]}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || command.status !== 'ready' || !command.command || !command.directory}
                  onClick={() => {
                    void navigator.clipboard.writeText(command.command).then(
                      () => setCopyStatus(c.copied),
                      () => setCopyStatus(c.copyFailed),
                    );
                  }}
                >
                  {c.copy}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(command)}>
                  {c.edit}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void save(commands.filter((item) => item.id !== command.id))}
                >
                  {c.remove}
                </Button>
              </div>
              {command.command && <pre className="whitespace-pre-wrap break-all text-xs">{command.command}</pre>}
              <div className="break-all text-xs text-muted-foreground">
                {c.directory}: {command.directory}
              </div>
              {command.source && (
                <div className="break-all text-xs text-muted-foreground">
                  {c.source}: {command.source}
                </div>
              )}
            </li>
          ))}
      </ul>
      {editing && (
        <ProjectCommandEditor
          initial={editing}
          onChange={setEditing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(command) =>
            save(
              commands.some((item) => item.id === command.id)
                ? commands.map((item) => (item.id === command.id ? command : item))
                : [...commands, command],
            )
          }
        />
      )}
    </div>
  );
}
