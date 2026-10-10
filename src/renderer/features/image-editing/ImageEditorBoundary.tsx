import { Component, type ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Keep the owning pin and its window controls visible if an editor component fails. */
export function ImageEditorBoundary({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const l = useI18n().messages.desktopPetals.imageEditor;
  return (
    <EditorBoundary
      fallback={
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface p-4 text-foreground">
          <span role="alert" className="text-sm">
            {l.loadFailed}
          </span>
          <Button variant="outline" onClick={onClose}>
            {l.backToImage}
          </Button>
        </div>
      }
    >
      {children}
    </EditorBoundary>
  );
}
