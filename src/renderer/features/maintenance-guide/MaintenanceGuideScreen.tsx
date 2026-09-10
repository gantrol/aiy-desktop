import { useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import type { MaintenanceProjectDraft } from '@/shared/contracts/maintenance-guide';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useMaintenanceGuide } from '@/renderer/features/maintenance-guide/useMaintenanceGuide';
import { MaintenanceProjectEditor } from '@/renderer/features/maintenance-guide/MaintenanceProjectEditor';
import { MaintenanceDocuments } from '@/renderer/features/maintenance-guide/MaintenanceDocuments';
import { MaintenanceResources } from '@/renderer/features/maintenance-guide/MaintenanceResources';

const emptyProject: MaintenanceProjectDraft = {
  name: '',
  website: '',
  release: '',
  notes: '',
  adsEnabled: false,
  toolUrls: {},
};

export function MaintenanceGuideScreen({ active, extension }: { active: boolean; extension: ExtensionDto }) {
  const l = useI18n().messages.maintenanceGuide;
  const authorized =
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted);
  const { state, busy, error, update, run } = useMaintenanceGuide(active && authorized);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState<{ projectId: string | null; draft: MaintenanceProjectDraft } | null>(null);
  const [removing, setRemoving] = useState(false);
  const project = state?.projects.find((item) => item.id === selectedId) ?? state?.projects[0];
  const api = window.desktopApi.maintenanceGuide;
  const saveProject = (draft: MaintenanceProjectDraft, projectId: string | null) =>
    state
      ? update(
          () => api.mutate({ kind: 'saveProject', revision: state.revision, projectId, project: draft }),
          (next) => {
            if (!projectId) setSelectedId(next.projects.at(-1)?.id ?? '');
          },
        )
      : Promise.resolve(false);

  if (!active) return null;
  if (!authorized)
    return (
      <div role="status" className="text-sm text-muted-foreground">
        {l.errors.disabled}
      </div>
    );
  return (
    <div className="grid gap-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        {project && (
          <Select value={project.id} onValueChange={setSelectedId} disabled={busy}>
            <SelectTrigger className="min-w-40 max-w-sm" aria-label={l.projects}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state?.projects.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          disabled={busy || !state || state.projects.length >= 50}
          onClick={() => setEditing({ projectId: null, draft: emptyProject })}
        >
          {l.addProject}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !state}
          onClick={() => {
            if (state) void update(() => api.importProjects({ revision: state.revision }));
          }}
        >
          {l.importProjects}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !state}
          onClick={() => {
            void run(() => api.exportProjects());
          }}
        >
          {l.exportProjects}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void update(() => api.list());
          }}
        >
          {l.refresh}
        </Button>
      </div>
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {l.errors[error]}
        </div>
      )}
      {busy && (
        <div role="status" className="text-xs text-muted-foreground">
          {l.loading}
        </div>
      )}
      {state && !project && <div className="py-8 text-sm text-muted-foreground">{l.noProjects}</div>}
      {project && state && (
        <div key={project.id} className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">{project.name}</h2>
            {project.release && <span className="font-mono text-xs">{project.release}</span>}
            {project.website && <span className="break-all text-xs text-muted-foreground">{project.website}</span>}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing({ projectId: project.id, draft: project })}
            >
              {l.editProject}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>
              {l.removeProject}
            </Button>
          </div>
          <Tabs defaultValue="guides">
            <TabsList>
              <TabsTrigger value="guides">{l.guides}</TabsTrigger>
              <TabsTrigger value="notes">{l.notes}</TabsTrigger>
              <TabsTrigger value="resources">{l.resources}</TabsTrigger>
            </TabsList>
            <TabsContent value="guides">
              <MaintenanceDocuments
                project={project}
                busy={busy}
                onAttach={() => {
                  void update(() => api.attachGuide({ revision: state.revision, projectId: project.id }));
                }}
                onRemove={(guideId) => {
                  void update(() =>
                    api.mutate({ kind: 'removeGuide', revision: state.revision, projectId: project.id, guideId }),
                  );
                }}
              />
            </TabsContent>
            <TabsContent value="notes" className="pt-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">
                {project.notes || l.noNotes}
              </pre>
            </TabsContent>
            <TabsContent value="resources">
              <MaintenanceResources
                project={project}
                busy={busy}
                onSave={(draft) => saveProject(draft, project.id)}
                onOpen={(toolId) => {
                  void run(() => api.openTool({ projectId: project.id, toolId }));
                }}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
      {editing && (
        <MaintenanceProjectEditor
          initial={editing.draft}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(draft) => saveProject(draft, editing.projectId)}
        />
      )}
      <Dialog
        open={removing}
        onOpenChange={(open) => {
          if (!busy) setRemoving(open);
        }}
      >
        <DialogContent className="rounded-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {l.removeProject}: {project?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setRemoving(false)}>
              {l.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!state || !project) return;
                void update(() =>
                  api.mutate({ kind: 'removeProject', revision: state.revision, projectId: project.id }),
                ).then((removed) => {
                  if (removed) setRemoving(false);
                });
              }}
            >
              {l.removeProject}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
