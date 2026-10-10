import { BookOpen } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useReadingHost } from '@/renderer/features/creation-reading/ReadingHost';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ReadingReferenceButton() {
  const host = useReadingHost();
  const copy = useI18n().messages.creationReading;
  if (!host) return null;
  return (
    <Button
      size="sm"
      variant={host.referencesOpen ? 'secondary' : 'ghost'}
      aria-expanded={host.referencesOpen}
      onClick={(event) => (host.referencesOpen ? host.closeReferences() : host.openReferences(event.currentTarget))}
    >
      <BookOpen className="size-4" />
      {copy.references}
    </Button>
  );
}
