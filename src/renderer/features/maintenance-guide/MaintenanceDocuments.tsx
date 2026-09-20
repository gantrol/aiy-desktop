import { useEffect, useState } from 'react';
import type { Components } from 'react-markdown';
import { ContentMarkdown } from '@/renderer/features/content-editor/ContentMarkdown';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import type {
  MaintenanceDocument,
  MaintenanceErrorCode,
  MaintenanceProject,
} from '@/shared/contracts/maintenance-guide';

// Handbooks are content: do not execute commands, load remote media, or navigate file/HTML links.
const components: Components = {
  a: ({ children, href }) => (
    <span className="underline underline-offset-2" title={href}>
      {children}
    </span>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};

interface Props {
  project: MaintenanceProject;
  busy: boolean;
  onAttach(): void;
  onRemove(guideId: string): void;
}

export function MaintenanceDocuments({ project, busy, onAttach, onRemove }: Props) {
  const l = useI18n().messages.maintenanceGuide;
  const [selectedId, setSelectedId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [document, setDocument] = useState<MaintenanceDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MaintenanceErrorCode | null>(null);
  const guide = project.guides.find((item) => item.id === selectedId) ?? project.guides[0];
  const guideId = guide?.id;

  useEffect(() => {
    let canceled = false;
    setDocument(null);
    setError(null);
    if (!guideId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.desktopApi.maintenanceGuide
      .readGuide({ projectId: project.id, guideId })
      .then((result) => {
        if (canceled) return;
        if (result.ok) setDocument(result.value);
        else setError(result.code);
      })
      .catch(() => {
        if (!canceled) setError('fileUnavailable');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [project.id, guideId, refresh]);

  return (
    <div className="grid gap-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {guide && (
          <Select value={guide.id} onValueChange={setSelectedId} disabled={busy}>
            <SelectTrigger className="min-w-40 max-w-sm" aria-label={l.guides}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {project.guides.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="sm" disabled={busy || project.guides.length >= 20} onClick={onAttach}>
          {l.attachGuide}
        </Button>
        {guide && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading || busy}
              onClick={() => setRefresh((value) => value + 1)}
            >
              {l.refresh}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRemove(guide.id)}>
              {l.unlinkGuide}
            </Button>
          </>
        )}
      </div>
      {guide && <div className="break-all font-mono text-xs text-muted-foreground">{guide.path}</div>}
      {loading && (
        <div role="status" className="text-sm text-muted-foreground">
          {l.loading}
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {l.errors[error]}
        </div>
      )}
      {!guide && <div className="py-8 text-sm text-muted-foreground">{l.noGuides}</div>}
      {document && (
        <>
          <time dateTime={document.modifiedAt} className="text-xs text-muted-foreground">
            {document.modifiedAt}
          </time>
          <article>
            <ContentMarkdown typography="compact" className="text-sm leading-7" components={components}>
              {document.text}
            </ContentMarkdown>
          </article>
        </>
      )}
    </div>
  );
}
