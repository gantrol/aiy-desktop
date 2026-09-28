import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { PublishingMaskDialog } from '@/renderer/features/browser-companion/PublishingMaskDialog';
import { type PublishingMaskSource, type PublishingMaskTarget } from '@/shared/contracts/publishing-mask';

export function PublishingMaskActions({
  spaceId,
  source,
  targets,
  disabled,
  beforeOpen,
  onSaved,
}: {
  spaceId: string;
  source: PublishingMaskSource;
  targets: readonly PublishingMaskTarget[];
  disabled: boolean;
  beforeOpen(): Promise<boolean>;
  onSaved?(): void;
}) {
  const { messages } = useI18n();
  const [editing, setEditing] = useState<PublishingMaskTarget | null>(null);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const ownerKey = JSON.stringify([spaceId, source.kind, source.id, targets]);
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function open(target: PublishingMaskTarget) {
    if (opening || disabled) return;
    setOpening(true);
    setFailed(false);
    const requestedOwner = ownerRef.current;
    try {
      const saved = await beforeOpen();
      if (!alive.current || disabledRef.current || ownerRef.current !== requestedOwner) return;
      if (saved) setEditing(target);
      else setFailed(true);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setOpening(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {targets.map((target) => (
          <Button
            key={`${target.platform}:${target.format}`}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || opening}
            onClick={() => void open(target)}
          >
            {messages.browserCompanion.targets[target.platform]}
            {target.platform === 'wechat' &&
              ` · ${target.format === 'inline-article' ? messages.browserCompanion.articleUpload : messages.browserCompanion.imagePostUpload}`}{' '}
            · {messages.publishing.mask.edit}
          </Button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {messages.publishing.saveFailed}
        </p>
      )}
      {editing && (
        <PublishingMaskDialog
          spaceId={spaceId}
          source={source}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => onSaved?.()}
        />
      )}
    </>
  );
}
