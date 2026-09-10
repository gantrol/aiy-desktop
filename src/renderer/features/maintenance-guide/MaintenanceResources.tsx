import { useId, useState } from 'react';
import { ExternalLinkIcon, PencilIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Badge } from '@/renderer/components/ui/badge';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  maintenanceWebUrlSchema,
  type MaintenanceProject,
  type MaintenanceProjectDraft,
  type MaintenanceToolId,
} from '@/shared/contracts/maintenance-guide';
import { maintenanceToolGroups, maintenanceTools, maintenanceToolUrl } from '@/shared/maintenance-tools';

interface Props {
  project: MaintenanceProject;
  busy: boolean;
  onSave(project: MaintenanceProjectDraft): Promise<boolean>;
  onOpen(toolId: MaintenanceToolId): void;
}

export function MaintenanceResources({ project, busy, onSave, onOpen }: Props) {
  const l = useI18n().messages.maintenanceGuide;
  const id = useId();
  const [editing, setEditing] = useState<MaintenanceToolId | null>(null);
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="grid gap-6 pt-4">
      <div className="flex flex-wrap items-center gap-4">
        <Badge variant="outline">{l.linksOnly}</Badge>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={project.adsEnabled}
            disabled={busy}
            onCheckedChange={(checked) => {
              void onSave({ ...project, adsEnabled: checked === true });
            }}
          />
          {l.enableAds}
        </label>
      </div>
      {maintenanceToolGroups.map((group) => (
        <section key={group} className="grid gap-2">
          <h3 className="text-sm font-medium">{l.groups[group]}</h3>
          <div className="grid gap-x-8 sm:grid-cols-2">
            {maintenanceTools
              .filter((tool) => tool.group === group && (tool.id !== 'ads' || project.adsEnabled))
              .map((tool) => {
                const target = maintenanceToolUrl(project, tool.id)!;
                return (
                  <div key={tool.id} className="flex min-w-0 items-center gap-1 border-b py-1.5">
                    <Button
                      variant="ghost"
                      className="min-w-0 flex-1 justify-start px-1"
                      disabled={busy}
                      title={target}
                      onClick={() => onOpen(tool.id)}
                    >
                      <span className="truncate">{l.tools[tool.id]}</span>
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
                    {project.toolUrls[tool.id] && <Badge variant="secondary">{l.linked}</Badge>}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      title={l.editLink}
                      aria-label={`${l.editLink}: ${l.tools[tool.id]}`}
                      onClick={() => {
                        setEditing(tool.id);
                        setUrl(project.toolUrls[tool.id] ?? '');
                        setInvalid(false);
                      }}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
          </div>
        </section>
      ))}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent className="rounded-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? l.tools[editing] : l.editLink}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = url.trim();
              if (trimmed && !maintenanceWebUrlSchema.safeParse(trimmed).success) {
                setInvalid(true);
                return;
              }
              if (!editing) return;
              const toolUrls = { ...project.toolUrls };
              if (trimmed) toolUrls[editing] = trimmed;
              else delete toolUrls[editing];
              void onSave({ ...project, toolUrls }).then((saved) => {
                if (saved) setEditing(null);
              });
            }}
          >
            <Label htmlFor={id}>{l.projectLink}</Label>
            <Input
              id={id}
              value={url}
              maxLength={4096}
              disabled={busy}
              placeholder={editing ? maintenanceTools.find((tool) => tool.id === editing)?.url : ''}
              onChange={(event) => {
                setUrl(event.target.value);
                setInvalid(false);
              }}
            />
            {invalid && (
              <div role="alert" className="text-sm text-destructive">
                {l.errors.invalidInput}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setUrl('')}>
                {l.resetLink}
              </Button>
              <Button type="submit" disabled={busy}>
                {l.save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
