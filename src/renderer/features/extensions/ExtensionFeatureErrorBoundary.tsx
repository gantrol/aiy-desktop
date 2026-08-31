import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCwIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

interface BoundaryProps {
  children: ReactNode;
  retryLabel: string;
  scope: string;
}

interface BoundaryState {
  error: string | null;
}

class ExtensionFeatureErrorBoundaryState extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(reason: unknown): BoundaryState {
    return { error: reason instanceof Error ? reason.message : String(reason) };
  }

  componentDidCatch(reason: Error, info: ErrorInfo) {
    console.error(`[extensions] renderer failure in ${this.props.scope}`, reason, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        data-extension-feature-error={this.props.scope}
        role="alert"
        className="flex min-h-24 items-center justify-center gap-3 border-y border-destructive/30 bg-destructive/5 px-4 py-3"
      >
        <span className="min-w-0 break-words text-xs text-destructive">{this.state.error}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
          <RotateCwIcon className="size-3.5" />
          {this.props.retryLabel}
        </Button>
      </div>
    );
  }
}

export function ExtensionFeatureErrorBoundary({ children, scope }: { children: ReactNode; scope: string }) {
  const retryLabel = useI18n().messages.app.retry;
  return (
    <ExtensionFeatureErrorBoundaryState key={scope} retryLabel={retryLabel} scope={scope}>
      {children}
    </ExtensionFeatureErrorBoundaryState>
  );
}
