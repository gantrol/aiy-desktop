import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { CollapsedNote } from '@/renderer/features/desktop-petals/CollapsedNote';
import { PetalLoadError } from '@/renderer/features/desktop-petals/PetalLoadError';
import { useI18n } from '@/renderer/i18n/useI18n';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalErrorCode } from '@/shared/petal-errors';
import { tracePetalGeometry } from '@/renderer/features/desktop-petals/petal-geometry-diagnostics';
import { ExtensionContentLinks } from '@/renderer/features/extensions/ExtensionContentLinks';
import { createCoalescedRefresh } from '@/shared/coalesced-refresh';

const StickyNote = lazy(() => import('./StickyNote').then((module) => ({ default: module.StickyNote })));
const PetalHub = lazy(() => import('./PetalHub').then((module) => ({ default: module.PetalHub })));
const ContentPin = lazy(() => import('./ContentPin').then((module) => ({ default: module.ContentPin })));

function ReadySurface({ children }: { children: ReactNode }) {
  const rendered = useRef(false);
  useEffect(() => {
    if (rendered.current) return;
    rendered.current = true;
    tracePetalGeometry('content-committed');
    void window.desktopPetals.rendered().catch(() => {
      rendered.current = false;
    });
  }, []);
  return children;
}

export function DesktopPetalsApp() {
  const { messages } = useI18n();
  const [snapshot, setSnapshot] = useState<DesktopPetalSnapshot | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
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
    const updates = createCoalescedRefresh(
      async () => {
        clearTimeout(retryTimer);
        const request = ++generation;
        tracePetalGeometry('snapshot-request', { request });
        const value = await window.desktopPetals.snapshot();
        tracePetalGeometry('snapshot-received', {
          request,
          accepted: live,
          snapshot: { point: value.point, anchor: value.flowerAnchor, preview: value.flowerPreview },
        });
        if (!live) return;
        // Requests are serialized. Accept this result even when another refresh
        // is queued, so a steady stream of changes cannot starve the first paint.
        setSnapshot(titlesVisible === undefined ? value : { ...value, titlesVisible });
        setError('');
      },
      (reason) => {
        if (!live) return;
        if (petalErrorCode(reason) === 'libraryUnavailable') {
          // Keep the editor mounted while its library drains or resumes.
          setSnapshot((current) => (current ? { ...current, suspended: true } : current));
          setError('');
          retryTimer = setTimeout(updates.request, 1_000);
        } else setError(String(reason));
      },
    );
    const refresh = () => {
      clearTimeout(retryTimer);
      updates.request();
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
      updates.dispose();
      clearTimeout(retryTimer);
      unsubscribe();
      unsubscribeTitles();
      window.removeEventListener('focus', refresh);
    };
  }, [retry]);
  const pin = snapshot?.board.pins.find((pin) => pin.id === snapshot.instanceId);
  return (
    <ExtensionContentLinks applications={snapshot?.contentApplications}>
      <Suspense fallback={null}>
        {snapshot &&
          (isContentPinId(snapshot.instanceId) && pin ? (
            <ReadySurface>
              <ContentPin key={`${snapshot.libraryId}:${pin.id}`} pin={pin} snapshot={snapshot} />
            </ReadySurface>
          ) : snapshot.instanceId && !snapshot.expanded && snapshot.summary ? (
            <ReadySurface>
              <CollapsedNote note={snapshot.summary} snapshot={snapshot} />
            </ReadySurface>
          ) : snapshot.instanceId && snapshot.expanded && snapshot.notes[0] ? (
            <ReadySurface>
              <StickyNote
                key={`${snapshot.libraryId}:${snapshot.instanceId}`}
                initialNote={snapshot.notes[0]}
                snapshot={snapshot}
              />
            </ReadySurface>
          ) : !snapshot.instanceId ? (
            <ReadySurface>
              <PetalHub snapshot={snapshot} />
            </ReadySurface>
          ) : (
            <PetalLoadError
              error="[aiy-petal:sourceUnavailable]"
              initial
              onRetry={() => setRetry((value) => value + 1)}
            />
          ))}
      </Suspense>
      {error && <PetalLoadError error={error} initial={!snapshot} onRetry={() => setRetry((value) => value + 1)} />}
    </ExtensionContentLinks>
  );
}
