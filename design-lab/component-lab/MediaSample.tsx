import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { ContentSurface } from '@/renderer/components/ui/content-surface';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { useI18n } from '@/renderer/i18n/useI18n';
import { portrait } from '../fixtures';

function MediaSession({ unavailable }: { unavailable: boolean }) {
  const { messages } = useI18n();
  const [failed, setFailed] = useState(unavailable);
  return (
    <div className="h-[32rem] max-w-sm">
      <ContentSurface
        kind="media"
        title={messages.designLab.cases.portrait}
        tools={null}
        className="h-full"
        status={
          failed ? (
            <div className="flex items-center justify-between gap-2">
              <span>{messages.designLab.sourceUnavailable}</span>
              <Button variant="ghost" size="xs" onClick={() => setFailed(false)}>
                {messages.referenceOutline.lookup.retry}
              </Button>
            </div>
          ) : undefined
        }
      >
        {!failed && (
          <AssetMedia
            asset={{ mediaUrl: portrait, mimeType: 'image/svg+xml', width: 400, height: 600 }}
            alt={messages.designLab.cases.portrait}
            onError={() => setFailed(true)}
          />
        )}
      </ContentSurface>
    </div>
  );
}

export function MediaSample({ unavailable = false }: { unavailable?: boolean }) {
  return <MediaSession key={String(unavailable)} unavailable={unavailable} />;
}
