import * as React from 'react';
import { cn } from '@/renderer/lib/utils';

export interface VirtualGridCell {
  rowKey: string;
  columnKey: string;
}

export interface VirtualGridAnchor {
  rowKey: string;
  columnKey: string;
  rowOffset: number;
  columnOffset: number;
  activeCell: VirtualGridCell | null;
  hadFocus: boolean;
  focusTarget: HTMLElement | null;
}

export interface VirtualGridHandle {
  focus(): void;
  focusCell(cell: VirtualGridCell, align?: 'auto' | 'center'): void;
  scrollToCell(cell: VirtualGridCell, align?: 'auto' | 'center'): void;
  captureAnchor(): VirtualGridAnchor | null;
  restoreAnchor(anchor: VirtualGridAnchor): void;
}

export interface VirtualRange {
  start: number;
  end: number;
}

export function getVirtualRange(
  count: number,
  itemSize: number,
  viewportOffset: number,
  viewportSize: number,
  overscan = 1,
): VirtualRange {
  if (count <= 0 || itemSize <= 0) return { start: 0, end: -1 };
  const safeOverscan = Math.max(0, Math.floor(overscan));
  if (viewportSize <= 0) return { start: 0, end: Math.min(count - 1, safeOverscan) };
  const start = Math.min(count - 1, Math.max(0, Math.floor(viewportOffset / itemSize) - safeOverscan));
  const end = Math.min(
    count - 1,
    Math.max(start, Math.ceil((viewportOffset + viewportSize) / itemSize) - 1 + safeOverscan),
  );
  return { start, end };
}

export function getNextVirtualGridCell(
  current: { rowIndex: number; columnIndex: number },
  rowCount: number,
  columnCount: number,
  key: string,
  controlOrMeta = false,
) {
  if (rowCount <= 0 || columnCount <= 0) return null;
  let rowIndex = Math.min(rowCount - 1, Math.max(0, current.rowIndex));
  let columnIndex = Math.min(columnCount - 1, Math.max(0, current.columnIndex));
  if (controlOrMeta && key === 'Home') return { rowIndex: 0, columnIndex: 0 };
  if (controlOrMeta && key === 'End') return { rowIndex: rowCount - 1, columnIndex: columnCount - 1 };
  if (key === 'ArrowUp') rowIndex = Math.max(0, rowIndex - 1);
  else if (key === 'ArrowDown') rowIndex = Math.min(rowCount - 1, rowIndex + 1);
  else if (key === 'ArrowLeft') columnIndex = Math.max(0, columnIndex - 1);
  else if (key === 'ArrowRight') columnIndex = Math.min(columnCount - 1, columnIndex + 1);
  else if (key === 'Home') columnIndex = 0;
  else if (key === 'End') columnIndex = columnCount - 1;
  else return null;
  return { rowIndex, columnIndex };
}

export function getRestoredVirtualGridScroll(
  anchor: Pick<VirtualGridAnchor, 'rowOffset' | 'columnOffset'>,
  rowIndex: number,
  columnIndex: number,
  rowHeight: number,
  columnWidth: number,
  current: { top: number; left: number },
) {
  return {
    top: rowIndex >= 0 ? Math.max(0, rowIndex * rowHeight + anchor.rowOffset) : current.top,
    left: columnIndex >= 0 ? Math.max(0, columnIndex * columnWidth + anchor.columnOffset) : current.left,
  };
}

interface VirtualGridRenderContext {
  rowIndex: number;
  columnIndex: number;
  active: boolean;
}

interface VirtualGridProps<Row, Column> extends Omit<
  React.ComponentProps<'div'>,
  'children' | 'role' | 'ref' | 'tabIndex'
> {
  rows: readonly Row[];
  columns: readonly Column[];
  getRowKey(row: Row, index: number): string;
  getColumnKey(column: Column, index: number): string;
  rowHeight: number;
  columnWidth: number;
  rowHeaderWidth: number;
  headerHeight?: number;
  overscan?: number;
  ariaLabel: string;
  cornerHeader: React.ReactNode;
  renderRowHeader(row: Row, index: number): React.ReactNode;
  renderColumnHeader(column: Column, index: number): React.ReactNode;
  renderCell(row: Row, column: Column, context: VirtualGridRenderContext): React.ReactNode;
  getCellLabel(row: Row, column: Column): string;
  activeCell?: VirtualGridCell | null;
  defaultActiveCell?: VirtualGridCell | null;
  onActiveCellChange?(cell: VirtualGridCell): void;
  onActivateCell?(row: Row, column: Column, cell: VirtualGridCell): void;
  rowHeaderClassName?: string;
  columnHeaderClassName?: string;
  cellClassName?: string;
}

function indicesInRange(range: VirtualRange, pinnedIndex: number) {
  const indices: number[] = [];
  for (let index = range.start; index <= range.end; index += 1) indices.push(index);
  if (pinnedIndex >= 0 && !indices.includes(pinnedIndex)) indices.push(pinnedIndex);
  return indices.sort((left, right) => left - right);
}

function indexIsInRange(index: number, range: VirtualRange) {
  return index >= range.start && index <= range.end;
}

export function encodeVirtualGridDomKey(value: string) {
  const encoded = encodeURIComponent(value);
  return `${encoded.length}-${encoded}`;
}

function VirtualGridInner<Row, Column>(
  {
    rows,
    columns,
    getRowKey,
    getColumnKey,
    rowHeight,
    columnWidth,
    rowHeaderWidth,
    headerHeight = 40,
    overscan = 1,
    ariaLabel,
    cornerHeader,
    renderRowHeader,
    renderColumnHeader,
    renderCell,
    getCellLabel,
    activeCell: controlledActiveCell,
    defaultActiveCell = null,
    onActiveCellChange,
    onActivateCell,
    rowHeaderClassName,
    columnHeaderClassName,
    cellClassName,
    className,
    style,
    onScroll,
    onKeyDown,
    ...props
  }: VirtualGridProps<Row, Column>,
  forwardedRef: React.ForwardedRef<VirtualGridHandle>,
) {
  const gridId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [internalActiveCell, setInternalActiveCell] = React.useState<VirtualGridCell | null>(defaultActiveCell);
  const [focusedContentCell, setFocusedContentCell] = React.useState<VirtualGridCell | null>(null);
  const [focusedRowHeaderKey, setFocusedRowHeaderKey] = React.useState<string | null>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 });
  const rowKeys = React.useMemo(() => rows.map((row, index) => getRowKey(row, index)), [getRowKey, rows]);
  const columnKeys = React.useMemo(
    () => columns.map((column, index) => getColumnKey(column, index)),
    [columns, getColumnKey],
  );
  const requestedActiveCell = controlledActiveCell === undefined ? internalActiveCell : controlledActiveCell;
  const requestedRowIndex = requestedActiveCell ? rowKeys.indexOf(requestedActiveCell.rowKey) : -1;
  const requestedColumnIndex = requestedActiveCell ? columnKeys.indexOf(requestedActiveCell.columnKey) : -1;
  const activeRowIndex = requestedRowIndex >= 0 ? requestedRowIndex : rows.length && columns.length ? 0 : -1;
  const activeColumnIndex = requestedColumnIndex >= 0 ? requestedColumnIndex : rows.length && columns.length ? 0 : -1;
  const effectiveActiveCell =
    activeRowIndex >= 0 && activeColumnIndex >= 0
      ? { rowKey: rowKeys[activeRowIndex], columnKey: columnKeys[activeColumnIndex] }
      : null;
  const totalWidth = rowHeaderWidth + columns.length * columnWidth;
  const totalHeight = headerHeight + rows.length * rowHeight;
  const hasRowHeader = rowHeaderWidth > 0;
  const columnAriaOffset = hasRowHeader ? 2 : 1;

  const commitActiveCell = React.useCallback(
    (cell: VirtualGridCell) => {
      if (controlledActiveCell === undefined) setInternalActiveCell(cell);
      onActiveCellChange?.(cell);
    },
    [controlledActiveCell, onActiveCellChange],
  );

  const measure = React.useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    setViewport({
      width: node.clientWidth,
      height: node.clientHeight,
      scrollLeft: node.scrollLeft,
      scrollTop: node.scrollTop,
    });
  }, []);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  const cellDomId = React.useCallback(
    (rowIndex: number, columnIndex: number) =>
      `${gridId}-cell-r${encodeVirtualGridDomKey(rowKeys[rowIndex] ?? '')}-c${encodeVirtualGridDomKey(columnKeys[columnIndex] ?? '')}`,
    [columnKeys, gridId, rowKeys],
  );

  const scrollToCellByIndex = React.useCallback(
    (rowIndex: number, columnIndex: number, align: 'auto' | 'center' = 'auto') => {
      const node = containerRef.current;
      if (!node || rowIndex < 0 || columnIndex < 0) return;
      const rowTop = rowIndex * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const columnLeft = columnIndex * columnWidth;
      const columnRight = columnLeft + columnWidth;
      let top = node.scrollTop;
      let left = node.scrollLeft;
      if (align === 'center') {
        top = rowTop - Math.max(0, node.clientHeight - headerHeight - rowHeight) / 2;
        left = columnLeft - Math.max(0, node.clientWidth - rowHeaderWidth - columnWidth) / 2;
      } else {
        if (rowTop < node.scrollTop) top = rowTop;
        else if (rowBottom > node.scrollTop + node.clientHeight - headerHeight)
          top = rowBottom - (node.clientHeight - headerHeight);
        if (columnLeft < node.scrollLeft) left = columnLeft;
        else if (columnRight > node.scrollLeft + node.clientWidth - rowHeaderWidth)
          left = columnRight - (node.clientWidth - rowHeaderWidth);
      }
      node.scrollTo({ top: Math.max(0, top), left: Math.max(0, left) });
    },
    [columnWidth, headerHeight, rowHeaderWidth, rowHeight],
  );

  React.useEffect(() => {
    if (!effectiveActiveCell) return;
    scrollToCellByIndex(activeRowIndex, activeColumnIndex);
  }, [
    activeColumnIndex,
    activeRowIndex,
    effectiveActiveCell?.columnKey,
    effectiveActiveCell?.rowKey,
    scrollToCellByIndex,
  ]);

  React.useEffect(() => {
    measure();
  }, [columnWidth, columns.length, headerHeight, measure, rowHeaderWidth, rowHeight, rows.length]);

  React.useEffect(() => {
    if (
      focusedContentCell &&
      (!rowKeys.includes(focusedContentCell.rowKey) || !columnKeys.includes(focusedContentCell.columnKey))
    ) {
      setFocusedContentCell(null);
    }
    if (focusedRowHeaderKey && !rowKeys.includes(focusedRowHeaderKey)) setFocusedRowHeaderKey(null);
  }, [columnKeys, focusedContentCell, focusedRowHeaderKey, rowKeys]);

  React.useImperativeHandle(
    forwardedRef,
    () => ({
      focus() {
        containerRef.current?.focus({ preventScroll: true });
      },
      focusCell(cell, align = 'auto') {
        const rowIndex = rowKeys.indexOf(cell.rowKey);
        const columnIndex = columnKeys.indexOf(cell.columnKey);
        if (rowIndex < 0 || columnIndex < 0) return;
        commitActiveCell(cell);
        scrollToCellByIndex(rowIndex, columnIndex, align);
        containerRef.current?.focus({ preventScroll: true });
      },
      scrollToCell(cell, align = 'auto') {
        scrollToCellByIndex(rowKeys.indexOf(cell.rowKey), columnKeys.indexOf(cell.columnKey), align);
      },
      captureAnchor() {
        const node = containerRef.current;
        if (!node || !rows.length || !columns.length) return null;
        const rowIndex = Math.min(rows.length - 1, Math.max(0, Math.floor(node.scrollTop / rowHeight)));
        const columnIndex = Math.min(columns.length - 1, Math.max(0, Math.floor(node.scrollLeft / columnWidth)));
        const focusTarget =
          typeof document !== 'undefined' &&
          document.activeElement instanceof HTMLElement &&
          node.contains(document.activeElement)
            ? document.activeElement
            : null;
        return {
          rowKey: rowKeys[rowIndex],
          columnKey: columnKeys[columnIndex],
          rowOffset: node.scrollTop - rowIndex * rowHeight,
          columnOffset: node.scrollLeft - columnIndex * columnWidth,
          activeCell: effectiveActiveCell,
          hadFocus: Boolean(focusTarget),
          focusTarget,
        };
      },
      restoreAnchor(anchor) {
        const node = containerRef.current;
        if (!node) return;
        const rowIndex = rowKeys.indexOf(anchor.rowKey);
        const columnIndex = columnKeys.indexOf(anchor.columnKey);
        const scroll = getRestoredVirtualGridScroll(anchor, rowIndex, columnIndex, rowHeight, columnWidth, {
          top: node.scrollTop,
          left: node.scrollLeft,
        });
        if (scroll.top !== node.scrollTop || scroll.left !== node.scrollLeft) node.scrollTo(scroll);
        if (
          anchor.activeCell &&
          rowKeys.includes(anchor.activeCell.rowKey) &&
          columnKeys.includes(anchor.activeCell.columnKey)
        ) {
          commitActiveCell(anchor.activeCell);
        }
        if (anchor.hadFocus) {
          const focusTarget = anchor.focusTarget;
          if (focusTarget?.isConnected && node.contains(focusTarget)) focusTarget.focus({ preventScroll: true });
          else node.focus({ preventScroll: true });
        }
      },
    }),
    [
      columnKeys,
      columnWidth,
      columns.length,
      commitActiveCell,
      effectiveActiveCell,
      rowHeight,
      rowKeys,
      rows.length,
      scrollToCellByIndex,
    ],
  );

  const rowRange = getVirtualRange(
    rows.length,
    rowHeight,
    viewport.scrollTop,
    Math.max(0, viewport.height - headerHeight),
    overscan,
  );
  const columnRange = getVirtualRange(
    columns.length,
    columnWidth,
    viewport.scrollLeft,
    Math.max(0, viewport.width - rowHeaderWidth),
    overscan,
  );
  const virtualRowIndices = indicesInRange(rowRange, activeRowIndex);
  const visibleColumnIndices = indicesInRange(columnRange, -1);

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget || !effectiveActiveCell) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onActivateCell?.(rows[activeRowIndex], columns[activeColumnIndex], effectiveActiveCell);
      return;
    }
    const next = getNextVirtualGridCell(
      { rowIndex: activeRowIndex, columnIndex: activeColumnIndex },
      rows.length,
      columns.length,
      event.key,
      event.ctrlKey || event.metaKey,
    );
    if (!next) return;
    event.preventDefault();
    commitActiveCell({ rowKey: rowKeys[next.rowIndex], columnKey: columnKeys[next.columnIndex] });
    scrollToCellByIndex(next.rowIndex, next.columnIndex);
  }

  return (
    <div
      ref={containerRef}
      data-slot="virtual-grid"
      role="grid"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + (hasRowHeader ? 1 : 0)}
      aria-activedescendant={effectiveActiveCell ? cellDomId(activeRowIndex, activeColumnIndex) : undefined}
      className={cn(
        'relative min-h-0 overflow-auto bg-background text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        className,
      )}
      style={style}
      onScroll={(event) => {
        const node = event.currentTarget;
        setViewport({
          width: node.clientWidth,
          height: node.clientHeight,
          scrollLeft: node.scrollLeft,
          scrollTop: node.scrollTop,
        });
        onScroll?.(event);
      }}
      onKeyDown={handleGridKeyDown}
      {...props}
    >
      <div data-slot="virtual-grid-canvas" className="relative" style={{ width: totalWidth, height: totalHeight }}>
        <div
          role="row"
          aria-rowindex={1}
          className="isolate sticky top-0 z-20"
          style={{ width: totalWidth, height: headerHeight }}
        >
          {hasRowHeader && (
            <div
              role="columnheader"
              aria-colindex={1}
              className="sticky left-0 z-30 flex items-center overflow-hidden border-r border-b bg-surface px-3 font-medium"
              style={{ width: rowHeaderWidth, height: headerHeight }}
            >
              {cornerHeader}
            </div>
          )}
          {visibleColumnIndices.map((columnIndex) => (
            <div
              key={columnKeys[columnIndex]}
              role="columnheader"
              aria-colindex={columnIndex + columnAriaOffset}
              data-virtual-column={columnKeys[columnIndex]}
              className={cn(
                'absolute top-0 flex items-center overflow-hidden border-r border-b bg-surface px-3 font-medium',
                columnHeaderClassName,
              )}
              style={{ left: rowHeaderWidth + columnIndex * columnWidth, width: columnWidth, height: headerHeight }}
            >
              {renderColumnHeader(columns[columnIndex], columnIndex)}
            </div>
          ))}
        </div>

        {virtualRowIndices.map((rowIndex) => {
          const rowVisible = indexIsInRange(rowIndex, rowRange);
          const keepRowHeaderContent = rowVisible || focusedRowHeaderKey === rowKeys[rowIndex];
          const rowColumnIndices = rowVisible
            ? indicesInRange(columnRange, activeColumnIndex)
            : activeColumnIndex >= 0
              ? [activeColumnIndex]
              : [];
          return (
            <div
              key={rowKeys[rowIndex]}
              role="row"
              aria-rowindex={rowIndex + 2}
              data-virtual-row={rowKeys[rowIndex]}
              className="absolute left-0"
              style={{ top: headerHeight + rowIndex * rowHeight, width: totalWidth, height: rowHeight }}
            >
              {hasRowHeader && (
                <div
                  role="rowheader"
                  aria-colindex={1}
                  className={cn(
                    'sticky left-0 z-10 overflow-hidden border-r border-b bg-surface p-3 text-left align-top',
                    rowHeaderClassName,
                  )}
                  style={{ width: rowHeaderWidth, height: rowHeight }}
                  onFocusCapture={() => {
                    setFocusedRowHeaderKey(rowKeys[rowIndex]);
                    if (activeColumnIndex >= 0)
                      commitActiveCell({
                        rowKey: rowKeys[rowIndex],
                        columnKey: columnKeys[activeColumnIndex],
                      });
                  }}
                  onBlurCapture={(event) => {
                    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
                      setFocusedRowHeaderKey((current) => (current === rowKeys[rowIndex] ? null : current));
                    }
                  }}
                >
                  {keepRowHeaderContent ? renderRowHeader(rows[rowIndex], rowIndex) : null}
                </div>
              )}
              {rowColumnIndices.map((columnIndex) => {
                const cell = { rowKey: rowKeys[rowIndex], columnKey: columnKeys[columnIndex] };
                const active = rowIndex === activeRowIndex && columnIndex === activeColumnIndex;
                const cellVisible = rowVisible && indexIsInRange(columnIndex, columnRange);
                const keepCellContent =
                  cellVisible ||
                  (focusedContentCell?.rowKey === cell.rowKey && focusedContentCell.columnKey === cell.columnKey);
                return (
                  <div
                    key={columnKeys[columnIndex]}
                    id={cellDomId(rowIndex, columnIndex)}
                    role="gridcell"
                    aria-rowindex={rowIndex + 2}
                    aria-colindex={columnIndex + columnAriaOffset}
                    aria-label={getCellLabel(rows[rowIndex], columns[columnIndex])}
                    data-virtual-grid-cell={`${rowKeys[rowIndex]}:${columnKeys[columnIndex]}`}
                    data-active={active || undefined}
                    className={cn(
                      'isolate absolute top-0 z-0 overflow-hidden border-r border-b bg-background outline-none data-[active=true]:z-[5] data-[active=true]:ring-2 data-[active=true]:ring-inset data-[active=true]:ring-ring',
                      cellClassName,
                    )}
                    style={{ left: rowHeaderWidth + columnIndex * columnWidth, width: columnWidth, height: rowHeight }}
                    onFocusCapture={() => {
                      setFocusedContentCell(cell);
                      commitActiveCell(cell);
                    }}
                    onBlurCapture={(event) => {
                      if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
                        setFocusedContentCell((current) =>
                          current?.rowKey === cell.rowKey && current.columnKey === cell.columnKey ? null : current,
                        );
                      }
                    }}
                    onPointerDownCapture={(event) => {
                      commitActiveCell(cell);
                      const target = event.target as HTMLElement;
                      const interactive = target.closest(
                        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
                      );
                      if (!interactive || !event.currentTarget.contains(interactive)) {
                        containerRef.current?.focus({ preventScroll: true });
                      }
                    }}
                  >
                    {keepCellContent
                      ? renderCell(rows[rowIndex], columns[columnIndex], { rowIndex, columnIndex, active })
                      : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const VirtualGrid = React.forwardRef(VirtualGridInner) as <Row, Column>(
  props: VirtualGridProps<Row, Column> & React.RefAttributes<VirtualGridHandle>,
) => React.ReactElement;

export { VirtualGrid };
