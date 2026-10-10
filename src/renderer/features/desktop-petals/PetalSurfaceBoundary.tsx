import { Component, useEffect, useState, type ReactNode } from 'react';
import { PetalLoadError } from '@/renderer/features/desktop-petals/PetalLoadError';

class SurfaceBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('[desktop-petals] surface render failed', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function FailedSurface({ onRetry }: { onRetry(): void }) {
  useEffect(() => {
    // A visible error is a completed first frame too; do not leave a transparent native window waiting.
    void window.desktopPetals.rendered().catch(() => undefined);
  }, []);
  return <PetalLoadError error="[aiy-petal:sourceUnavailable]" initial onRetry={onRetry} />;
}

/** Rendering failures keep a visible retry/hide surface inside the owning transparent window. */
export function PetalSurfaceBoundary({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  return (
    <SurfaceBoundary key={revision} fallback={<FailedSurface onRetry={() => setRevision((value) => value + 1)} />}>
      {children}
    </SurfaceBoundary>
  );
}
