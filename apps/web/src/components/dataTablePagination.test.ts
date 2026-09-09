import { getPageCount, clampPage, getPageSlice } from './dataTablePagination';

describe('getPageCount', () => {
  it('computes the number of pages for evenly divisible rows', () => {
    expect(getPageCount(100, 50)).toBe(2);
  });

  it('rounds up for a partial final page', () => {
    expect(getPageCount(101, 50)).toBe(3);
  });

  it('returns 0 pages when there are no rows', () => {
    expect(getPageCount(0, 50)).toBe(0);
  });

  it('returns 1 page when rows fit within a single page', () => {
    expect(getPageCount(10, 50)).toBe(1);
  });
});

describe('clampPage', () => {
  it('clamps a page below 1 up to 1', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });

  it('clamps a page beyond the page count down to the last page', () => {
    expect(clampPage(9, 5)).toBe(5);
  });

  it('passes through a valid page unchanged', () => {
    expect(clampPage(3, 5)).toBe(3);
  });

  it('returns 1 when there are no pages at all', () => {
    expect(clampPage(1, 0)).toBe(1);
  });
});

describe('getPageSlice', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);

  it('returns the first page slice', () => {
    expect(getPageSlice(rows, 1, 50)).toEqual(rows.slice(0, 50));
  });

  it('returns the second page slice', () => {
    expect(getPageSlice(rows, 2, 50)).toEqual(rows.slice(50, 100));
  });

  it('returns a partial final page slice', () => {
    expect(getPageSlice(rows, 3, 50)).toEqual(rows.slice(100, 120));
  });

  it('returns all rows when fewer rows exist than one page', () => {
    const small = [1, 2, 3];
    expect(getPageSlice(small, 1, 50)).toEqual(small);
  });

  it('clamps an out-of-range page request to the last valid page', () => {
    expect(getPageSlice(rows, 99, 50)).toEqual(rows.slice(100, 120));
  });

  it('returns an empty array for an empty row set', () => {
    expect(getPageSlice([], 1, 50)).toEqual([]);
  });
});
