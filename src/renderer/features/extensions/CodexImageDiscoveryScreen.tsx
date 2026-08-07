import type { ExtensionDto } from '@/shared/contracts';
import { ImagesIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CodexImageDiscoveryConfiguration } from '@/renderer/features/extensions/CodexImageDiscoveryConfiguration';

interface Props {
  active: boolean;
  extension: ExtensionDto | null;
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

export function CodexImageDiscoveryScreen({ active, extension, notify, onOpenCreation }: Props) {
  const l = useI18n().messages.extensions.codexImageDiscovery;

  if (!extension) {
    return (
      <section className="flex size-full min-h-0 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-5">
          <ImagesIcon className="size-4" />
          <h1 className="text-base font-semibold">{l.title}</h1>
        </header>
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">{l.unavailable}</div>
      </section>
    );
  }

  return (
    <CodexImageDiscoveryConfiguration
      active={active}
      extension={extension}
      standalone
      notify={notify}
      onOpenCreation={onOpenCreation}
    />
  );
}
