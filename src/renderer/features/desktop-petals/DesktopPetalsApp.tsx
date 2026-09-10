import { useEffect, useRef, useState } from 'react';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { PetalHub } from '@/renderer/features/desktop-petals/PetalHub';
import { StickyNote } from '@/renderer/features/desktop-petals/StickyNote';
import { PetalLoadError } from '@/renderer/features/desktop-petals/PetalLoadError';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentPin } from '@/renderer/features/desktop-petals/ContentPin';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalErrorCode } from '@/shared/petal-errors';
import { tracePetalGeometry } from '@/renderer/features/desktop-petals/petal-geometry-diagnostics';
import { ExtensionContentLinks } from '@/renderer/features/extensions/ExtensionContentLinks';

export function DesktopPetalsApp() {
  const { messages } = useI18n();
  const [snapshot, setSnapshot] = useState<DesktopPetalSnapshot | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const rendered = useRef(false);
  useEffect(() => {
    if (!snapshot || error || rendered.current) return;
    if (snapshot.instanceId && !snapshot.notes[0] && !snapshot.board.pins.some((pin) => pin.id === snapshot.instanceId))
      return;
    // The native window stays hidden until this acknowledgement. Animation
    // frames can be suspended there, so report the committed content directly.
    rendered.current = true;
    tracePetalGeometry('content-committed', { note: Boolean(snapshot.instanceId), expanded: snapshot.expanded });
    void window.desktopPetals.rendered().catch(() => {
      rendered.current = false;
    });
  }, [snapshot, error]);
  useEffect(() => {
    document.title = snapshot?.instanceId
      ? messages.desktopPetals.note.windowTitle
      : messages.desktopPetals.flower.title;
  }, [snapshot?.instanceId, messages.desktopPetals]);
  useEffect(() => {
    let live = true,
      generation = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let titlesVisible: boolean | undefined;
    const refresh = () => {
      clearTimeout(retryTimer);
      const request = ++generation;
      tracePetalGeometry('snapshot-request', { request });
      void window.desktopPetals
        .snapshot()
        .then((value) => {
          tracePetalGeometry('snapshot-received', {
            request,
            accepted: live && generation === request,
            snapshot: { point: value.point, anchor: value.flowerAnchor, preview: value.flowerPreview },
          });
          if (live && generation === request) {
            setSnapshot(titlesVisible === undefined ? value : { ...value, titlesVisible });
            setError('');
          }
        })
        .catch((reason) => {
          if (!live || generation !== request) return;
          if (petalErrorCode(reason) === 'libraryUnavailable') {
            // Keep the editor mounted while its library drains or resumes.
            setSnapshot((current) => (current ? { ...current, suspended: true } : current));
            setError('');
            retryTimer = setTimeout(refresh, 1_000);
          } else setError(String(reason));
        });
    };
    const unsubscribe = window.desktopPetals.onChanged(refresh);
    const unsubscribeTitles = window.desktopPetals.onTitlesChanged((visible) => {
      titlesVisible = visible;
      setSnapshot((current) => (current ? { ...current, titlesVisible: visible } : current));
    });
    window.addEventListener('focus', refresh);
    refresh();
    return () => {
      live = false;
      clearTimeout(retryTimer);
      unsubscribe();
      unsubscribeTitles();
      window.removeEventListener('focus', refresh);
    };
  }, [retry]);
  const pin = snapshot?.board.pins.find((pin) => pin.id === snapshot.instanceId);
  return (
    <ExtensionContentLinks applications={snapshot?.contentApplications}>
      {snapshot &&
        (isContentPinId(snapshot.instanceId) && pin ? (
          <ContentPin key={`${snapshot.libraryId}:${pin.id}`} pin={pin} snapshot={snapshot} />
        ) : snapshot.instanceId && snapshot.notes[0] ? (
          <StickyNote
            key={`${snapshot.libraryId}:${snapshot.instanceId}`}
            initialNote={snapshot.notes[0]}
            snapshot={snapshot}
          />
        ) : !snapshot.instanceId ? (
          <PetalHub snapshot={snapshot} />
        ) : (
          <PetalLoadError
            error="[aiy-petal:sourceUnavailable]"
            initial
            onRetry={() => setRetry((value) => value + 1)}
          />
        ))}
      {error && <PetalLoadError error={error} initial={!snapshot} onRetry={() => setRetry((value) => value + 1)} />}
    </ExtensionContentLinks>
  );
}
