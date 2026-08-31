import type { PackReleaseSummaryDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  releases: PackReleaseSummaryDto[];
  selectedReleaseId: string;
  installedReleaseId: string | null;
  busy: boolean;
  onSelect(releaseId: string): void;
  onApply(release: PackReleaseSummaryDto): void;
}

export function PackReleaseHistory({
  releases,
  selectedReleaseId,
  installedReleaseId,
  busy,
  onSelect,
  onApply,
}: Props) {
  const { messages } = useI18n();
  const l = messages.packs;
  const selected = releases.find((release) => release.id === selectedReleaseId) ?? null;

  return (
    <section className="border-y py-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{l.sections.releases}</h3>
        {selected && installedReleaseId && selected.id !== installedReleaseId && (
          <Button className="ml-auto" type="button" size="sm" disabled={busy} onClick={() => onApply(selected)}>
            {l.actions.useRelease}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {releases.map((release) => (
          <Button
            key={release.id}
            type="button"
            size="sm"
            variant={release.id === selectedReleaseId ? 'secondary' : 'ghost'}
            aria-pressed={release.id === selectedReleaseId}
            onClick={() => onSelect(release.id)}
          >
            {release.version}
            {release.id === installedReleaseId && <Badge variant="outline">{l.currentRelease}</Badge>}
          </Button>
        ))}
      </div>
    </section>
  );
}
