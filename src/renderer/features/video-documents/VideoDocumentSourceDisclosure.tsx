import { ChevronDown, ChevronUp, PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';
import { forwardRef, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';

const DOCKED_SOURCE_PANE_MINIMUM_REM = 56;

interface VideoDocumentSourcePaneToggleProps {
  open: boolean;
  placement: 'workspace-header' | 'source-header';
  collapseLabel: string;
  expandLabel: string;
  contentId: string;
  onOpenChange(open: boolean): void;
}

export const VideoDocumentSourcePaneToggle = forwardRef<HTMLButtonElement, VideoDocumentSourcePaneToggleProps>(
  function VideoDocumentSourcePaneToggle(
    { open, placement, collapseLabel, expandLabel, contentId, onOpenChange },
    ref,
  ) {
    const compact = placement === 'source-header';
    const label = open ? collapseLabel : expandLabel;
    const icon = compact ? (
      open ? (
        <ChevronDown className="size-4" />
      ) : (
        <ChevronUp className="size-4" />
      )
    ) : open ? (
      <PanelRightCloseIcon className="size-4" />
    ) : (
      <PanelRightOpenIcon className="size-4" />
    );

    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="icon-sm"
        title={label}
        aria-label={label}
        aria-controls={contentId}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {icon}
      </Button>
    );
  },
);

/** Keep keyboard focus on the disclosure when its responsive host changes. */
export function useVideoDocumentSourceDisclosure(enabled = true) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const activeToggleRef = useRef<HTMLButtonElement | null>(null);
  const restoreToggleFocus = useRef(false);
  const [docked, setDocked] = useState(true);
  const contentId = `video-document-source-${useId().replaceAll(':', '')}`;
  const toggleRef = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return;
    activeToggleRef.current = button;
    if (restoreToggleFocus.current) {
      restoreToggleFocus.current = false;
      button.focus({ preventScroll: true });
    }
    return () => {
      restoreToggleFocus.current = button.ownerDocument.activeElement === button;
      if (activeToggleRef.current === button) activeToggleRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const ownerDocument = workspace.ownerDocument;
    const view = ownerDocument.defaultView;
    const rootFontSize = Number.parseFloat(view?.getComputedStyle(ownerDocument.documentElement).fontSize ?? '16');
    const dockedMinimum = DOCKED_SOURCE_PANE_MINIMUM_REM * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
    const update = (width: number) => setDocked(width >= dockedMinimum);

    update(workspace.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [enabled]);

  return { workspaceRef, toggleRef, docked, contentId };
}
