import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { ResultLibraryMode } from '@/renderer/components/creator/ResultLibrary';
import {
  loadCreatorPreferences,
  defaultOutputPanelRatio,
  maximumOutputPanelRatio,
  minimumCenterWidth,
  minimumOutputWidth,
  minimumOutputPanelRatio,
  minimumResultListWidth,
  outputThumbnailWidth,
  resultThumbnailWidth,
  saveCreatorPreferences,
} from '@/renderer/components/creator/creatorPreferences';

interface Input {
  showResultLibrary: boolean;
  showOutputInspector: boolean;
  comparisonFullWindow: boolean;
}

export interface CreatorPanes {
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  multiPane: boolean;
  compactPanel: 'library' | 'creator' | 'output';
  setCompactPanel(panel: 'library' | 'creator' | 'output'): void;
  resultLibraryMode: ResultLibraryMode;
  canExpandResultLibrary: boolean;
  setResultLibraryMode(mode: ResultLibraryMode): void;
  resultWidth: number;
  resultResizeMin: number;
  resultResizeMax: number;
  setResultWidth(width: number): void;
  outputWidth: number;
  outputResizeMin: number;
  outputResizeMax: number;
  setOutputWidth(width: number): void;
  outputCollapsed: boolean;
  setOutputCollapsed(collapsed: boolean): void;
  beginResultResize(event: ReactPointerEvent<HTMLDivElement>): void;
  beginOutputResize(event: ReactPointerEvent<HTMLDivElement>): void;
  workspaceGridStyle: CSSProperties | undefined;
}

export interface CreatorPaneGeometryInput {
  workspaceWidth: number;
  showResultLibrary: boolean;
  showOutputInspector: boolean;
  resultLibraryMode: ResultLibraryMode;
  resultPanelWidth: number;
  outputPanelRatio: number;
  outputCollapsed: boolean;
}

export interface CreatorPaneGeometry {
  resultLibraryMode: ResultLibraryMode;
  canExpandResultLibrary: boolean;
  resultWidth: number;
  centerWidth: number;
  outputWidth: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Calculates pixels from a persisted ratio without changing that ratio when the window is constrained. */
export function creatorPaneGeometry({
  workspaceWidth,
  showResultLibrary,
  showOutputInspector,
  resultLibraryMode,
  resultPanelWidth,
  outputPanelRatio,
  outputCollapsed,
}: CreatorPaneGeometryInput): CreatorPaneGeometry {
  const minimumReservedOutput = showOutputInspector ? (outputCollapsed ? outputThumbnailWidth : minimumOutputWidth) : 0;
  const maximumResultWidth = Math.max(
    resultThumbnailWidth,
    workspaceWidth - minimumCenterWidth - minimumReservedOutput,
  );
  const canExpandResultLibrary = showResultLibrary && maximumResultWidth >= minimumResultListWidth;
  const effectiveResultLibraryMode =
    showResultLibrary && resultLibraryMode === 'full' && !canExpandResultLibrary ? 'images' : resultLibraryMode;
  const resultWidth = !showResultLibrary
    ? 0
    : effectiveResultLibraryMode === 'images'
      ? resultThumbnailWidth
      : Math.min(resultPanelWidth, maximumResultWidth);
  const splitWidth = Math.max(0, workspaceWidth - resultWidth);
  const maximumOutputWidth = Math.max(0, splitWidth - minimumCenterWidth);
  const minimumExpandedOutputWidth = Math.min(minimumOutputWidth, maximumOutputWidth);
  const safeOutputPanelRatio =
    Number.isFinite(outputPanelRatio) &&
    outputPanelRatio >= minimumOutputPanelRatio &&
    outputPanelRatio <= maximumOutputPanelRatio
      ? outputPanelRatio
      : defaultOutputPanelRatio;
  const outputWidth = !showOutputInspector
    ? 0
    : outputCollapsed
      ? Math.min(outputThumbnailWidth, maximumOutputWidth)
      : clamp(splitWidth * safeOutputPanelRatio, minimumExpandedOutputWidth, maximumOutputWidth);

  return {
    resultLibraryMode: effectiveResultLibraryMode,
    canExpandResultLibrary,
    resultWidth,
    centerWidth: Math.max(0, splitWidth - outputWidth),
    outputWidth,
  };
}

function dragPane(event: ReactPointerEvent<HTMLDivElement>, onMove: (delta: number) => void): () => void {
  event.preventDefault();
  const startX = event.clientX;
  const previousCursor = document.body.style.cursor;
  const previousSelection = document.body.style.userSelect;
  let active = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const move = (pointer: PointerEvent) => onMove(pointer.clientX - startX);
  const finish = () => {
    if (!active) return;
    active = false;
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelection;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    window.removeEventListener('blur', finish);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  window.addEventListener('blur', finish);
  return finish;
}

/**
 * Owns creator pane geometry: responsive thresholds, drag-to-resize, and the persisted layout.
 * The screen only says which panes exist; every width decision lives here.
 */
export function useCreatorPanes({ showResultLibrary, showOutputInspector, comparisonFullWindow }: Input): CreatorPanes {
  const stored = useRef(loadCreatorPreferences()).current;
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth);
  const [multiPane, setMultiPane] = useState(() => window.matchMedia('(min-width: 840px)').matches);
  const [compactPanel, setCompactPanel] = useState<'library' | 'creator' | 'output'>('creator');
  const [resultLibraryMode, setResultLibraryMode] = useState<ResultLibraryMode>(stored.resultLibraryMode);
  const [resultPanelWidth, setResultPanelWidth] = useState(stored.resultPanelWidth);
  const [outputPanelRatio, setOutputPanelRatio] = useState(stored.outputPanelRatio);
  const [outputCollapsed, setOutputCollapsed] = useState(stored.outputCollapsed);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const geometry = creatorPaneGeometry({
    workspaceWidth,
    showResultLibrary,
    showOutputInspector,
    resultLibraryMode,
    resultPanelWidth,
    outputPanelRatio,
    outputCollapsed,
  });
  const { resultWidth, outputWidth } = geometry;
  const minimumReservedOutput = showOutputInspector ? (outputCollapsed ? outputThumbnailWidth : minimumOutputWidth) : 0;
  const resultResizeMax = Math.max(resultThumbnailWidth, workspaceWidth - minimumReservedOutput - minimumCenterWidth);
  const outputSplitWidth = Math.max(1, workspaceWidth - resultWidth);
  const outputResizeMax = Math.max(outputThumbnailWidth, outputSplitWidth - minimumCenterWidth);

  const workspaceGridStyle =
    !comparisonFullWindow && multiPane
      ? {
          gridTemplateColumns: [
            showResultLibrary ? `${resultWidth}px` : null,
            `minmax(${minimumCenterWidth}px, 1fr)`,
            showOutputInspector ? `${outputWidth}px` : null,
          ]
            .filter(Boolean)
            .join(' '),
        }
      : undefined;

  useEffect(() => {
    saveCreatorPreferences({ resultLibraryMode, resultPanelWidth, outputPanelRatio, outputCollapsed });
  }, [resultLibraryMode, resultPanelWidth, outputPanelRatio, outputCollapsed]);

  useEffect(
    () => () => {
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const multiPaneWindow = window.matchMedia('(min-width: 840px)');
    const matchWindow = (event: MediaQueryListEvent) => setMultiPane(event.matches);
    multiPaneWindow.addEventListener('change', matchWindow);
    return () => multiPaneWindow.removeEventListener('change', matchWindow);
  }, []);

  useEffect(() => {
    if (!showOutputInspector && compactPanel === 'output') setCompactPanel('creator');
  }, [compactPanel, showOutputInspector]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return undefined;
    const updateWorkspaceWidth = (width: number) => {
      if (width > 0) setWorkspaceWidth(width);
    };
    const observer = new ResizeObserver(([entry]) => updateWorkspaceWidth(entry.contentRect.width));
    observer.observe(workspace);
    updateWorkspaceWidth(workspace.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  function beginResultResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!geometry.canExpandResultLibrary && geometry.resultLibraryMode === 'images') return;
    activeDragCleanupRef.current?.();
    const startWidth = resultWidth;
    activeDragCleanupRef.current = dragPane(event, (delta) => {
      setResultWidth(startWidth + delta);
    });
  }

  function setResultWidth(requestedWidth: number) {
    let next = clamp(requestedWidth, resultThumbnailWidth, resultResizeMax);
    if (geometry.resultLibraryMode === 'images' && next > resultWidth && geometry.canExpandResultLibrary) {
      next = Math.max(minimumResultListWidth, next);
    }
    if (!geometry.canExpandResultLibrary) return;
    if (next < minimumResultListWidth) {
      setResultLibraryMode('images');
      return;
    }
    setResultPanelWidth(Math.max(minimumResultListWidth, next));
    setResultLibraryMode('full');
  }

  function beginOutputResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (outputResizeMax < minimumOutputWidth) return;
    activeDragCleanupRef.current?.();
    const startWidth = outputWidth;
    activeDragCleanupRef.current = dragPane(event, (delta) => {
      setOutputWidth(startWidth - delta);
    });
  }

  function setOutputWidth(requestedWidth: number) {
    let next = clamp(requestedWidth, outputThumbnailWidth, outputResizeMax);
    const canExpand = outputResizeMax >= minimumOutputWidth;
    if (outputCollapsed && next > outputWidth && canExpand) next = Math.max(minimumOutputWidth, next);
    if (!canExpand) return;
    if (next < minimumOutputWidth) {
      setOutputCollapsed(true);
      return;
    }
    setOutputPanelRatio(
      clamp(Math.max(minimumOutputWidth, next) / outputSplitWidth, minimumOutputPanelRatio, maximumOutputPanelRatio),
    );
    setOutputCollapsed(false);
  }

  return {
    workspaceRef,
    multiPane,
    compactPanel,
    setCompactPanel,
    resultLibraryMode: geometry.resultLibraryMode,
    canExpandResultLibrary: geometry.canExpandResultLibrary,
    setResultLibraryMode,
    resultWidth,
    resultResizeMin: resultThumbnailWidth,
    resultResizeMax,
    setResultWidth,
    outputWidth,
    outputResizeMin: outputThumbnailWidth,
    outputResizeMax,
    setOutputWidth,
    outputCollapsed,
    setOutputCollapsed,
    beginResultResize,
    beginOutputResize,
    workspaceGridStyle,
  };
}
