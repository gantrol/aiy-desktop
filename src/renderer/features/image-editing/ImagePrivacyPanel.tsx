import { useId } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { useImagePrivacy } from '@/renderer/features/image-editing/use-image-privacy';

export function ImagePrivacyPanel({
  privacy,
  disabled,
}: {
  privacy: ReturnType<typeof useImagePrivacy>;
  disabled: boolean;
}) {
  const { messages, locale } = useI18n();
  const copy = messages.desktopPetals.imageEditor.privacy;
  const id = useId();
  const number = new Intl.NumberFormat(locale);
  const busy = privacy.status === 'scanning';
  return (
    <section
      aria-label={copy.title}
      className="flex max-h-56 shrink-0 flex-col gap-2 overflow-auto border-t border-border px-2 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{copy.title}</span>
        <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label={copy.close} onClick={privacy.close}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        {(['email', 'phone', 'credential', 'custom'] as const).map((kind) => (
          <label key={kind} className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={privacy.kinds.includes(kind)}
              disabled={disabled || busy}
              onCheckedChange={() => privacy.toggleKind(kind)}
            />
            {copy[kind]}
          </label>
        ))}
      </div>
      {privacy.kinds.includes('custom') && (
        <div className="flex flex-col gap-1">
          <label className="text-xs" htmlFor={id}>
            {copy.terms}
          </label>
          <Textarea
            id={id}
            rows={2}
            maxLength={3030}
            value={privacy.terms}
            disabled={disabled || busy}
            onChange={(event) => privacy.setTerms(event.target.value)}
          />
        </div>
      )}
      {privacy.current && (
        <div className="flex flex-wrap gap-2" aria-label={copy.candidates}>
          {privacy.current.candidates.map(({ kind, mark }, index) => (
            <label key={mark.id} className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={privacy.current!.selected.has(mark.id)}
                disabled={disabled}
                onCheckedChange={() => privacy.toggleCandidate(mark.id)}
              />
              {copy[kind]} {number.format(index + 1)}
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className="text-xs text-muted-foreground">
          {privacy.current
            ? copy.review.replace('{count}', number.format(privacy.selectedCount))
            : privacy.status === 'idle'
              ? ''
              : copy[privacy.status]}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {busy ? (
            <Button size="sm" variant="outline" onClick={privacy.stop}>
              {copy.stop}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !privacy.kinds.length}
              onClick={() => void privacy.scan()}
            >
              {copy.scan}
            </Button>
          )}
          {privacy.current && (
            <Button size="sm" disabled={disabled || !privacy.selectedCount} onClick={privacy.apply}>
              {copy.apply}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
