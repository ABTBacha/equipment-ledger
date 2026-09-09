'use client';

import { useEffect, useState } from 'react';
import { getPageCount, getPageSlice, clampPage } from './dataTablePagination';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  loading?: boolean;
  /** Render slot for row actions, appended as a final column when provided. */
  actions?: (row: T) => React.ReactNode;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  pageSize = 50,
  loading = false,
  actions,
  emptyMessage = 'No rows to show.',
}: DataTableProps<T>) {
  const [page, setPage] = useState(1);
  const pageCount = getPageCount(rows.length, pageSize);

  useEffect(() => {
    setPage((p) => clampPage(p, pageCount || 1));
    // Reset to a valid page whenever the underlying row set changes size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, pageSize]);

  const visibleRows = getPageSlice(rows, page, pageSize);
  const allColumns = actions ? [...columns, { key: '__actions', header: 'Actions', render: actions }] : columns;

  return (
    <div>
      <div className="overflow-x-auto border border-hairline bg-surface">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-hairline">
              {allColumns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left font-normal text-muted px-3 py-2 whitespace-nowrap ${col.className ?? ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columnCount={allColumns.length} rowCount={Math.min(pageSize, 8)} />
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={allColumns.length} className="px-3 py-6 text-center text-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, i) => (
                <tr
                  key={rowKey(row)}
                  className={`border-b border-hairline last:border-b-0 hover:bg-raised ${
                    i % 2 === 1 ? 'bg-base' : 'bg-surface'
                  }`}
                >
                  {allColumns.map((col) => (
                    <td key={col.key} className={`px-3 py-2 align-middle ${col.className ?? ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-muted">
          <span>
            Page {page} of {pageCount} ({rows.length} rows)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => clampPage(p - 1, pageCount))}
              disabled={page <= 1}
              className="px-3 py-1 border border-hairline disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => clampPage(p + 1, pageCount))}
              disabled={page >= pageCount}
              className="px-3 py-1 border border-hairline disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonRows({ columnCount, rowCount }: { columnCount: number; rowCount: number }) {
  return (
    <>
      {Array.from({ length: rowCount }).map((_, r) => (
        <tr key={r} className="border-b border-hairline last:border-b-0">
          {Array.from({ length: columnCount }).map((_, c) => (
            <td key={c} className="px-3 py-2">
              <div className="h-3 rounded-sm bg-raised animate-skeleton" style={{ width: `${60 + ((r + c) % 4) * 10}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
