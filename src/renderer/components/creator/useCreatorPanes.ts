import { useWorkbenchScopeKey } from '@/renderer/components/workbench/WorkbenchScope';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
import { beginPanePointerDrag } from '@/renderer/components/workbench/paneResize';

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
  animateDisclosure: boolean;
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
    showResultLibrary && resultLibraryMode !== 'images' && !canExpandResultLibrary ? 'images' : resultLibraryMode;
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

/**
 * Owns creator pane geometry: responsive thresholds, drag-to-resize, and the persisted layout.
 * The screen only says which panes exist; every width decision lives here.
 */
export function useCreatorPanes({ showResultLibrary, showOutputInspector, comparisonFullWindow }: Input): CreatorPanes {
  const scope = useWorkbenchScopeKey('creator');
  const [stored] = useState(() => loadCreatorPreferences(scope));
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth);
  const multiPane = workspaceWidth >= 840;
  const [compactPanel, setCompactPanel] = useState<'library' | 'creator' | 'output'>('creator');
  const [resultCollapsed, setResultCollapsed] = useState(stored.resultLibraryMode === 'images');
  const [panePriority, setPanePriority] = useState<'library' | 'output'>('output');
  const [animateDisclosure, setAnimateDisclosure] = useState(false);
  const resultLibraryMode = resultCollapsed ? 'images' : 'full';
  function setResultLibraryMode(mode: ResultLibraryMode) {
    setAnimateDisclosure(true);
    setResultCollapsed(mode === 'images');
    if (mode !== 'images') {
      setPanePriority('library');
    }
  }
  const [resultPanelWidth, setResultPanelWidth] = useState(stored.resultPanelWidth);
  const [outputPanelRatio, setOutputPanelRatio] = useState(stored.outputPanelRatio);
  const [outputCollapsed, saveOutputCollapsed] = useState(stored.outputCollapsed);
  function setOutputCollapsed(collapsed: boolean) {
    saveOutputCollapsed(collapsed);
    if (!collapsed) setPanePriority('output');
  }
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const competing =
    showResultLibrary &&
    showOutputInspector &&
    !resultCollapsed &&
    !outputCollapsed &&
    workspaceWidth < minimumResultListWidth + minimumCenterWidth + minimumOutputWidth;
  const effectiveOutputCollapsed = outputCollapsed || (competing && panePriority === 'library');
  const effectiveLibraryMode = competing && panePriority === 'output' ? 'images' : resultLibraryMode;
  const canExpandResultLibrary =
    showResultLibrary &&
    workspaceWidth >= minimumResultListWidth + minimumCenterWidth + (showOutputInspector ? outputThumbnailWidth : 0);
  const geometry = creatorPaneGeometry({
    workspaceWidth,
    showResultLibrary,
    showOutputInspector,
    resultLibraryMode: effectiveLibraryMode,
    resultPanelWidth,
    outputPanelRatio,
    outputCollapsed: effectiveOutputCollapsed,
  });
  const { resultWidth, outputWidth } = geometry;
  const minimumReservedOutput = showOutputInspector
    ? effectiveOutputCollapsed
      ? outputThumbnailWidth
      : minimumOutputWidth
    : 0;
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
    saveCreatorPreferences({ resultLibraryMode, resultPanelWidth, outputPanelRatio, outputCollapsed }, scope);
  }, [resultLibraryMode, resultPanelWidth, outputPanelRatio, outputCollapsed, scope]);

  useEffect(
    () => () => {
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    activeDragCleanupRef.current?.();
    setAnimateDisclosure(false);
  }, [comparisonFullWindow, scope, showOutputInspector, showResultLibrary, workspaceWidth]);

  useEffect(() => {
    if (!showOutputInspector && compactPanel === 'output') setCompactPanel('creator');
  }, [compactPanel, showOutputInspector]);

  useLayoutEffect(() => {
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
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      (!canExpandResultLibrary && geometry.resultLibraryMode === 'images')
    )
      return;
    activeDragCleanupRef.current?.();
    const startWidth = resultWidth;
    const initial = { panePriority, resultCollapsed, resultPanelWidth };
    let active = true;
    let removeListeners: (() => void) | null = null;
    const finish = (cancelled: boolean) => {
      if (!active) return;
      active = false;
      removeListeners?.();
      activeDragCleanupRef.current = null;
      if (!cancelled) return;
      setPanePriority(initial.panePriority);
      setResultCollapsed(initial.resultCollapsed);
      setResultPanelWidth(initial.resultPanelWidth);
    };
    removeListeners = beginPanePointerDrag(event, (delta) => setResultWidth(startWidth + delta), finish);
    activeDragCleanupRef.current = () => finish(true);
  }

  function setResultWidth(requestedWidth: number) {
    let next = clamp(requestedWidth, resultThumbnailWidth, resultResizeMax);
    if (geometry.resultLibraryMode === 'images' && next > resultWidth && canExpandResultLibrary) {
      next = Math.max(minimumResultListWidth, next);
    }
    if (!canExpandResultLibrary) return;
    if (next < minimumResultListWidth) {
      setResultLibraryMode('images');
      setAnimateDisclosure(false);
      return;
    }
    setAnimateDisclosure(false);
    setResultPanelWidth(Math.max(minimumResultListWidth, next));
    setResultCollapsed(false);
    setPanePriority('library');
  }

  function beginOutputResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.isPrimary === false || outputResizeMax < minimumOutputWidth) return;
    activeDragCleanupRef.current?.();
    const startWidth = outputWidth;
    const initial = { outputCollapsed, outputPanelRatio, panePriority };
    let active = true;
    let removeListeners: (() => void) | null = null;
    const finish = (cancelled: boolean) => {
      if (!active) return;
      active = false;
      removeListeners?.();
      activeDragCleanupRef.current = null;
      if (!cancelled) return;
      setPanePriority(initial.panePriority);
      saveOutputCollapsed(initial.outputCollapsed);
      setOutputPanelRatio(initial.outputPanelRatio);
    };
    removeListeners = beginPanePointerDrag(event, (delta) => setOutputWidth(startWidth - delta), finish);
    activeDragCleanupRef.current = () => finish(true);
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
    resultLibraryMode: multiPane ? geometry.resultLibraryMode : 'full',
    canExpandResultLibrary,
    setResultLibraryMode,
    resultWidth,
    resultResizeMin: resultThumbnailWidth,
    resultResizeMax,
    setResultWidth,
    outputWidth,
    outputResizeMin: outputThumbnailWidth,
    outputResizeMax,
    setOutputWidth,
    outputCollapsed: multiPane && effectiveOutputCollapsed,
    setOutputCollapsed,
    beginResultResize,
    beginOutputResize,
    workspaceGridStyle,
    animateDisclosure,
  };
}
