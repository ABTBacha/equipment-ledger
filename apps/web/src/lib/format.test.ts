import { formatDateTime, formatOverlapMessage } from './format';

describe('formatDateTime', () => {
  it('renders an instant in the viewer local timezone, not as a UTC ISO string', () => {
    const iso = '2026-09-10T12:30:00.000Z';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
    expect(formatDateTime(iso)).not.toContain(iso);
  });

  it('renders a dash for a missing instant', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatOverlapMessage', () => {
  it('rewrites a RESERVATION_OVERLAP body into local times', () => {
    const message = formatOverlapMessage({
      code: 'RESERVATION_OVERLAP',
      message: 'Overlaps an existing reservation from 2026-09-10T12:30:00.000Z to 2026-09-11T12:30:00.000Z',
      conflict: { startAt: '2026-09-10T12:30:00.000Z', endAt: '2026-09-11T12:30:00.000Z' },
    });

    expect(message).toBe(
      `Overlaps an existing reservation from ${new Date('2026-09-10T12:30:00.000Z').toLocaleString()} to ${new Date(
        '2026-09-11T12:30:00.000Z',
      ).toLocaleString()}`,
    );
  });

  it('returns null for a body that is not an overlap conflict, so the caller keeps its own message', () => {
    expect(formatOverlapMessage({ message: 'Asset DRILL-001 is out of service' })).toBeNull();
    expect(formatOverlapMessage(undefined)).toBeNull();
  });

  it('returns null when the code is present but the conflict window is malformed', () => {
    expect(formatOverlapMessage({ code: 'RESERVATION_OVERLAP', conflict: { startAt: 'nonsense' } })).toBeNull();
  });
});
