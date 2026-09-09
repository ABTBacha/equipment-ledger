/** Pure pagination helpers for DataTable, kept separate so they're easy to unit test. */

export function getPageCount(totalRows: number, pageSize: number): number {
  if (pageSize <= 0) return totalRows > 0 ? 1 : 0;
  if (totalRows <= 0) return 0;
  return Math.ceil(totalRows / pageSize);
}

/** Clamps a requested page (1-indexed) into the valid [1, pageCount] range (or 1 if pageCount is 0). */
export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 1;
  if (page < 1) return 1;
  if (page > pageCount) return pageCount;
  return page;
}

export function getPageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const pageCount = getPageCount(rows.length, pageSize);
  const clamped = clampPage(page, pageCount);
  const start = (clamped - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
