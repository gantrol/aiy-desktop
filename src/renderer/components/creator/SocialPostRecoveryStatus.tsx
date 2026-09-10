import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { SocialPostContentPreview } from '@/renderer/components/creator/SocialPostSaveConflict';
import type { useSocialPostSaveSession } from '@/renderer/components/creator/useSocialPostSaveSession';

export function SocialPostRecoveryStatus({ session }: { session: ReturnType<typeof useSocialPostSaveSession> }) {
  const { messages } = useI18n();
  const copy = messages.creator.socialPostSave;
  const status = session.recoveryStatus;
  if (status === 'saved' && !session.dirty) return null;
  const conflicted = status === 'conflict';
  const failed = status === 'error';
  const snapshot = session.recoveryConflict?.snapshot;
  return (
    <section
      role={conflicted || failed ? 'alert' : 'status'}
      className="grid shrink-0 gap-2 border-b bg-surface-sunken px-4 py-3 text-sm"
    >
      <p>
        {conflicted
          ? copy.recoveryConflict
          : failed
            ? copy.recoveryError
            : !session.ready
              ? copy.loading
              : session.inputPending
                ? copy.waitingForImages
                : status === 'saved'
                  ? copy.recoverySaved
                  : copy.recoverySaving}
      </p>
      {failed && (
        <Button className="w-fit" size="sm" variant="outline" onClick={() => void session.retry()}>
          {copy.retry}
        </Button>
      )}
      {conflicted && (
        <details>
          <summary className="cursor-pointer">{copy.compareRecovery}</summary>
          {snapshot ? (
            <SocialPostContentPreview content={snapshot.content} assets={session.mediaAssets} />
          ) : (
            <p className="mt-2">{copy.recoveryCleared}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={session.saving} onClick={() => session.resolveRecovery(true)}>
              {copy.keepRecovery}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={session.saving}
              onClick={() => session.resolveRecovery(false)}
            >
              {copy.loadRecovery}
            </Button>
          </div>
        </details>
      )}
    </section>
  );
}
