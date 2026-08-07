import * as React from 'react';
import { VirtualGrid, type VirtualGridCell } from '@/renderer/components/ui/virtual-grid';

const virtualTableColumn = { key: '__virtual-table-row__' } as const;
const virtualTableColumns = [virtualTableColumn] as const;

export interface VirtualTableRenderContext {
  rowIndex: number;
  active: boolean;
}

export interface VirtualTableProps<Row> extends Omit<React.ComponentProps<'div'>, 'children' | 'role' | 'ref'> {
  rows: readonly Row[];
  getRowKey(row: Row, index: number): string;
  getRowLabel(row: Row): string;
  rowHeight: number;
  columnWidth: number;
  headerHeight?: number;
  overscan?: number;
  ariaLabel: string;
  header: React.ReactNode;
  renderRow(row: Row, context: VirtualTableRenderContext): React.ReactNode;
  activeRowKey?: string | null;
  defaultActiveRowKey?: string | null;
  onActiveRowChange?(rowKey: string): void;
  onActivateRow?(row: Row): void;
  headerClassName?: string;
  rowClassName?: string;
}

function rowCell(rowKey: string | null | undefined): VirtualGridCell | null | undefined {
  if (rowKey == null) return rowKey;
  return { rowKey, columnKey: virtualTableColumn.key };
}

function VirtualTable<Row>({
  rows,
  getRowKey,
  getRowLabel,
  rowHeight,
  columnWidth,
  headerHeight,
  overscan,
  ariaLabel,
  header,
  renderRow,
  activeRowKey,
  defaultActiveRowKey,
  onActiveRowChange,
  onActivateRow,
  headerClassName,
  rowClassName,
  ...props
}: VirtualTableProps<Row>) {
  return (
    <VirtualGrid
      {...props}
      data-slot="virtual-table"
      rows={rows}
      columns={virtualTableColumns}
      getRowKey={getRowKey}
      getColumnKey={(column) => column.key}
      rowHeight={rowHeight}
      columnWidth={columnWidth}
      rowHeaderWidth={0}
      headerHeight={headerHeight}
      overscan={overscan}
      ariaLabel={ariaLabel}
      cornerHeader={null}
      renderRowHeader={() => null}
      renderColumnHeader={() => header}
      renderCell={(row, _column, context) => renderRow(row, { rowIndex: context.rowIndex, active: context.active })}
      getCellLabel={(row) => getRowLabel(row)}
      activeCell={rowCell(activeRowKey)}
      defaultActiveCell={rowCell(defaultActiveRowKey)}
      onActiveCellChange={onActiveRowChange ? (cell) => onActiveRowChange(cell.rowKey) : undefined}
      onActivateCell={onActivateRow ? (row) => onActivateRow(row) : undefined}
      columnHeaderClassName={headerClassName}
      cellClassName={rowClassName}
    />
  );
}

export { VirtualTable };
