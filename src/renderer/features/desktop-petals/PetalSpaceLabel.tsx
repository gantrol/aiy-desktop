import { useI18n } from '@/renderer/i18n/useI18n';

/** Context, not a move or a cross-library browsing control. */
export function PetalSpaceLabel({ name }: { name: string }) {
  const copy = useI18n().messages.desktopPetals.scope;
  return (
    <div className="shrink-0 px-2 py-2 text-xs" title={copy.behavior}>
      <p className="truncate font-medium" title={`${copy.current} · ${name}`}>
        {copy.current} · {name}
      </p>
    </div>
  );
}
