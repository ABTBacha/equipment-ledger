import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { HistoryTimeline } from './HistoryTimeline';
import { HistoryEntryView } from '../lib/types';

const baseMovement = {
  _id: 'm1',
  assetId: 'DRILL-001',
  workerId: 'worker-1',
  type: 'RETURN' as const,
  occurredAt: '2026-08-01T09:00:00.000Z',
  recordedAt: '2026-08-01T09:00:00.000Z',
  dueAt: null,
  reason: null,
};

describe('HistoryTimeline', () => {
  it('renders a corrected entry with its correction inline and no "Correct this entry" action', () => {
    const entries: HistoryEntryView[] = [
      {
        movement: baseMovement,
        correction: { ...baseMovement, _id: 'm2', occurredAt: '2026-08-01T11:00:00.000Z', reason: 'Logged the wrong time' },
      },
    ];
    render(<HistoryTimeline entries={entries} onCorrected={jest.fn()} />);
    expect(screen.getByText('Corrected')).toBeInTheDocument();
    expect(screen.getByText('Logged the wrong time')).toBeInTheDocument();
    expect(screen.queryByText('Correct this entry')).not.toBeInTheDocument();
  });

  it('renders an uncorrected entry with a "Correct this entry" action', () => {
    const entries: HistoryEntryView[] = [{ movement: baseMovement, correction: null }];
    render(<HistoryTimeline entries={entries} onCorrected={jest.fn()} />);
    expect(screen.getByText('Correct this entry')).toBeInTheDocument();
    expect(screen.queryByText('Corrected')).not.toBeInTheDocument();
  });

  it('shows the due-back time an issue recorded', () => {
    render(
      <HistoryTimeline
        entries={[
          {
            movement: {
              _id: 'm1',
              assetId: 'DRILL-001',
              workerId: 'worker-1',
              type: 'ISSUE',
              occurredAt: '2026-08-01T09:00:00.000Z',
              recordedAt: '2026-08-01T09:00:00.000Z',
              dueAt: '2026-08-01T17:00:00.000Z',
              reason: null,
            },
            correction: null,
          },
        ]}
        onCorrected={() => {}}
      />,
    );

    expect(screen.getByText(/due back/i)).toBeInTheDocument();
  });
});
