import type { ReactNode } from 'react';

type Column<T> = {
  header: string;
  // Tailwind width/flex class for both the header label and every row's
  // cell in this column, e.g. 'flex-1', 'w-28', 'w-10'. Defaults to 'flex-1'.
  width?: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  emptyMessage: string;
  // Extra classes for a specific row's container, e.g. a status tint.
  rowClassName?: (row: T) => string;
};

// Shared header-bar + row list used by every admin table (ingredients,
// menu, tables, reports). Centralizing this fixes the header/row
// alignment and full-bleed background in one place instead of six.
export function DataTable<T>({ columns, rows, rowKey, emptyMessage, rowClassName }: DataTableProps<T>) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-6 bg-bg -mx-4 px-4 py-2 text-xs font-bold text-text-muted-2 uppercase">
        {columns.map((col) => (
          <span key={col.header} className={`${col.width ?? 'flex-1'} ${col.align === 'right' ? 'text-right' : ''}`}>
            {col.header}
          </span>
        ))}
      </div>
      {rows?.map((row) => (
        <div
          key={rowKey(row)}
          className={`flex items-center gap-6 py-2 border-b border-border last:border-0 ${rowClassName?.(row) ?? ''}`}
        >
          {columns.map((col) => (
            <span key={col.header} className={`${col.width ?? 'flex-1'} ${col.align === 'right' ? 'text-right' : ''}`}>
              {col.render(row)}
            </span>
          ))}
        </div>
      ))}
      {rows?.length === 0 && (
        <p className="text-text-muted text-sm text-center py-6">{emptyMessage}</p>
      )}
    </div>
  );
}
