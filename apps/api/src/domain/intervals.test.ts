import { intervalsOverlap } from './intervals';

const d = (s: string) => new Date(s);

describe('intervalsOverlap', () => {
  it('returns true for clearly overlapping windows', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T12:00Z'), d('2026-10-01T20:00Z'))).toBe(true);
  });

  it('returns false for adjacent (touching) windows', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T20:00Z'))).toBe(false);
  });

  it('returns true when one window fully contains the other', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T20:00Z'), d('2026-10-01T12:00Z'), d('2026-10-01T14:00Z'))).toBe(true);
  });

  it('returns true for identical windows', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'))).toBe(true);
  });

  it('returns false for windows far apart', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-11-01T09:00Z'), d('2026-11-01T17:00Z'))).toBe(false);
  });
});
