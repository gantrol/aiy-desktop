import { useEffect, useState } from 'react';
import { FilmIcon, LoaderCircleIcon } from 'lucide-react';
import type { AssetFileRevealContext } from '@/shared/contracts';
import { ContextMenuIcon, ContextMenuItem } from '@/renderer/components/ui/context-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useGifMakerLauncher } from '@/renderer/features/gif-making/GifMakerProvider';

export function GifContextMenuItem({
  assetId,
  revealContext,
  usableInCreation = true,
}: {
  assetId: string;
  revealContext: AssetFileRevealContext;
  usableInCreation?: boolean;
}) {
  const launcher = useGifMakerLauncher();
  const { messages } = useI18n();
  const labels = messages.creator.gifMaker;
  const seriesId = revealContext.kind === 'CREATION' ? revealContext.seriesId : null;
  const enabled = Boolean(launcher && usableInCreation);
  const [lookup, setLookup] = useState<{
    assetId: string;
    seriesId: string | null;
    documentId: string | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // This component mounts only while the asset menu is open. Resolve from export
    // records as well as source frames, so earlier exports retain their own entry.
    void window.desktopApi.gifFindForAsset(assetId, 'GIF', seriesId).then(
      (documentId) => {
        if (!cancelled) setLookup({ assetId, seriesId, documentId, failed: false });
      },
      () => {
        if (!cancelled) setLookup({ assetId, seriesId, documentId: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assetId, seriesId, enabled]);
  if (!launcher || !usableInCreation) return null;
  const current = lookup?.assetId === assetId && lookup.seriesId === seriesId ? lookup : null;
  const loading = !current;
  const Icon = loading ? LoaderCircleIcon : FilmIcon;
  return (
    <ContextMenuItem
      data-action={current?.documentId ? 'asset-resume-gif' : 'asset-make-gif'}
      disabled={launcher.busy || loading || current.failed}
      onSelect={() =>
        void launcher.open(
          current?.documentId ? { documentId: current.documentId } : { assetId, seriesId, forceNew: true },
        )
      }
    >
      <ContextMenuIcon>
        <Icon className={loading ? 'animate-spin' : undefined} />
      </ContextMenuIcon>
      {current?.failed
        ? messages.creator.workNavigation.openFailed
        : current?.documentId
          ? labels.resume
          : labels.title}
    </ContextMenuItem>
  );
}
